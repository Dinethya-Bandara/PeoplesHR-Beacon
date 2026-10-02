(async function (data, args, reqOptions) {
  try {
    if (
      !BeaconBar.user?.metaData?.menus?.some(menu =>
        menu.includes("TNDV9/TrainingNeed/Index?mvc=1&bs=4&App=000001")
      )
    ) {
      return { error: true, message: "You do not have access to apply for a training need. Please contact HR Admin." };
    }

    const existingNeedName = args.existingNeedName ? String(args.existingNeedName).trim() : "";
    const newNeedName = args.newNeedName ? String(args.newNeedName).trim() : "";
    const newNeedDescription = args.newNeedDescription ? String(args.newNeedDescription).trim() : "";
    const objective = args.objective ? String(args.objective).trim() : "";
    const goalTitle = args.goalTitle ? String(args.goalTitle).trim() : "";
    const enableGoalObjectives = args.enableGoalObjectives === true || String(args.enableGoalObjectives).toLowerCase() === "true";
    const relevanceToJob = args.relevanceToJob ? String(args.relevanceToJob).trim() : "";
    const benefitToEmployee = args.benefitToEmployee ? String(args.benefitToEmployee).trim() : "";
    const benefitToCompany = args.benefitToCompany ? String(args.benefitToCompany).trim() : "";

    const headers = new Headers();
    headers.append("Accept", "*/*");
    headers.append("Content-Type", "application/json");
    headers.append("x-requested-with", "XMLHttpRequest");

    async function postJson(path, body) {
      const url = `${window.origin}/${reqOptions.sl}/${path}`;
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: headers,
          body: body !== undefined ? JSON.stringify(body) : undefined
        });
      } catch (networkError) {
        throw new Error(`Could not reach ${path}: ${networkError.message}`);
      }
      const rawText = await response.text();
      let parsed = null;
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch (parseError) {
        throw new Error(`${path} returned a non-JSON response (HTTP ${response.status}).`);
      }
      if (!response.ok) {
        const detail = (parsed && (parsed.Message || (parsed.Status && parsed.Status.Message))) || rawText.slice(0, 200);
        throw new Error(`${path} failed with HTTP ${response.status}: ${detail}`);
      }
      return parsed;
    }

    // FEATURE ADD (2026-09-14): mirrors the real form's "Enable Goal Objectives" checkbox,
    // which loads the employee's ongoing performance goals straight into the Objectives
    // dropdown (see the screenshot in the request that prompted this) - previously this
    // tool only ever fetched GetOngoingGoals internally to resolve an already-known
    // goalTitle by exact match; there was no way for the employee to browse the list
    // first. When enableGoalObjectives is true and goalTitle hasn't been chosen yet, fetch
    // and return the list directly - deliberately BEFORE existingNeedName/newNeedName is
    // required, since picking a goal is independent of picking a need on the real form.
    // GetOngoingGoals never writes anything, so this is always safe to call standalone.
    if (enableGoalObjectives && !goalTitle) {
      const goalsData = await postJson("TNDV9/TrainingNeed/GetOngoingGoals", undefined);
      const ongoingGoals = (Array.isArray(goalsData) ? goalsData : []).map((g) => ({
        goalTitle: g.GoalTitle || "",
        goalCode: g.GoalCode
      }));
      return {
        status: "GOALS_LISTED",
        message: ongoingGoals.length > 0
          ? "Here are the employee's ongoing performance goals. Present the titles and ask which one to link as this training need's objective, then call this tool again with goalTitle set to their exact choice (along with existingNeedName/newNeedName and the other required fields)."
          : "The employee has no ongoing performance goals to link right now - use the objective argument instead for a free-text objective.",
        ongoingGoals: ongoingGoals
      };
    }

    if (!existingNeedName && !newNeedName) {
      return {
        status: "VALIDATION_ERROR",
        message: "Provide either existingNeedName (to attach this application to an existing training need - see getSelfTrainingNeeds) or newNeedName (to submit a brand new one), not neither."
      };
    }
    if (existingNeedName && newNeedName) {
      return {
        status: "VALIDATION_ERROR",
        message: "Provide either existingNeedName or newNeedName, not both - the real form's Training Need Type is either 'Existing Need' or 'New Need', never both at once."
      };
    }

    // Step 1: fetch the existing-need master list (MainNeed) and the self "subordinate"
    // record (SuborList[0]) - confirmed live: for the Applicant persona, GetTrainingNeedDetails'
    // SuborList contains exactly one entry, the logged-in employee's own record with
    // selected: 1 already set, the same "self is the only entry" pattern
    // selfEmployeeTrainingApplication's SubList[0] and getSelfTrainingNeeds already rely on.
    // This record is what gets echoed back (trimmed to a specific field subset - see Step 6)
    // as the outgoing EmpList entry - confirmed live via a real submitted payload.
    const detailsData = await postJson("TNDV9/TrainingNeed/GetTrainingNeedDetails", { requestType: "000001", WFMainID: "", PerfEmpNo: "" });
    if (!detailsData || !detailsData.Status || detailsData.Status.IsSuccessfull !== true) {
      return {
        status: "ERROR",
        message: (detailsData && detailsData.Status && detailsData.Status.Message) || "Failed to load the training need application form"
      };
    }
    const mainNeed = Array.isArray(detailsData.MainNeed) ? detailsData.MainNeed : [];
    const selfRecord = Array.isArray(detailsData.SuborList) ? detailsData.SuborList[0] : null;
    if (!selfRecord) {
      return {
        status: "ERROR",
        message: "Could not resolve the logged-in employee's own record from the training need application form."
      };
    }

    // Step 2: fetch the employee's ongoing performance goals - confirmed live, called again
    // (fresh) every time the real "Add" button is pressed on the form, feeding both the
    // goal-picker dropdown (when 'Enable Goal Objectives' is checked) and the ExistingGoals
    // field that's echoed back verbatim in the submission payload regardless of which mode
    // is used. Also re-fetched here (not just reused from the standalone listing branch
    // above) since this call may be reached directly with goalTitle already known, without
    // ever going through the listing branch first.
    const goalsData = await postJson("TNDV9/TrainingNeed/GetOngoingGoals", undefined);
    const existingGoals = Array.isArray(goalsData) ? goalsData : [];

    // Step 3: resolve the Training Need Type selection - Existing (typecode 1, a real
    // needcode, blank needname/needdescription) or New (typecode 0, needcode "000000",
    // free-text needname/needdescription) - confirmed live from both a real "existing need"
    // and a real "new need" submission capture.
    let typecode;
    let needcode;
    let needname;
    let needdescription;
    if (existingNeedName) {
      const lowerNeedName = existingNeedName.toLowerCase();
      const matches = mainNeed.filter((n) => (n.needname || "").toLowerCase().includes(lowerNeedName));
      if (matches.length === 0) {
        return {
          status: "ERROR",
          message: `No existing training need matching "${args.existingNeedName}" was found. Use getSelfTrainingNeeds to see what's currently on file, or pass newNeedName to submit a new one.`
        };
      }
      if (matches.length > 1) {
        return {
          status: "AMBIGUOUS",
          message: `More than one existing training need matches "${args.existingNeedName}".`,
          ambiguousField: "existingNeedName",
          candidates: matches.map((n) => ({ needCode: n.needcode, needName: n.needname }))
        };
      }
      typecode = 1;
      needcode = matches[0].needcode;
      needname = "";
      needdescription = "";
    } else {
      typecode = 0;
      needcode = "000000";
      needname = newNeedName;
      needdescription = newNeedDescription;
    }

    // Step 4: resolve the objective - either free text, or (when 'Enable Goal Objectives'
    // is used) linked to one of the employee's ongoing goals. Confirmed live: when
    // IsGoalObject is true, the literal "objective" field is sent blank and
    // SelectedGoalCode carries the real value instead - the server's "Please specify the
    // objective." validation covers both cases (a blank text objective, or a blank/unset
    // SelectedGoalCode), so only one of the two needs to be populated.
    let isGoalObject = false;
    let finalObjective = objective;
    let selectedGoalCode = null;
    if (goalTitle) {
      const lowerGoalTitle = goalTitle.toLowerCase();
      const goalMatches = existingGoals.filter((g) => (g.GoalTitle || "").trim().toLowerCase() === lowerGoalTitle);
      if (goalMatches.length === 0) {
        return {
          status: "ERROR",
          message: `No ongoing goal titled "${args.goalTitle}" was found. Call this tool again with enableGoalObjectives: true (and no goalTitle) to see the current list, or provide the objective argument instead for a free-text objective.`
        };
      }
      if (goalMatches.length > 1) {
        return {
          status: "AMBIGUOUS",
          message: `More than one ongoing goal is titled "${args.goalTitle}" - they can't be told apart by title alone. Provide the objective argument instead to enter a free-text objective.`,
          ambiguousField: "goalTitle"
        };
      }
      isGoalObject = true;
      finalObjective = "";
      selectedGoalCode = goalMatches[0].GoalCode;
    }

    // Step 5: attachments (detection only, no network) - read files from the Beacon chat's
    // own upload mechanism, the same source every other write tool in this build reads from
    // (see submitMyGrievanceApplication, selfEmployeeLeaveApplication). Entirely optional:
    // with no files attached, Attach/FileNameAttached/AttchList stay at their original "no
    // attachment" values below and none of PrepareNeedAttachments/UploadFile is ever called.
    // Detected here (rather than inside Step 7) purely so the confirmation preview in Step 6
    // can list what's about to be attached - the actual upload is deferred until confirmed.
    function uploadedFiles() {
      try {
        if (typeof BeaconBar !== "undefined" && typeof BeaconBar.getUploadedBaoFiles === "function") {
          const bao = BeaconBar.getUploadedBaoFiles();
          return Array.isArray(bao) ? bao.filter(Boolean) : (bao ? [bao] : []);
        }
      } catch (e) {
        // Degrade to "no files" rather than throw.
      }
      return [];
    }

    const attachedFiles = uploadedFiles();
    const attchList = [];

    // Step 6: confirmation gate - confirmed live via TNDV9/Common/GetTndResource
    // ({resource: "TndNeedApplicationSaveConfirm"} -> "Are you sure you want to submit
    // this training need?"): the real form always shows this confirm dialog right before
    // Save, after every field has already been filled in. Nothing is uploaded, validated,
    // or saved until the employee has reviewed this exact application and confirmed -
    // placed here (after the need/objective/attachment-detection steps, before any write
    // call) so the preview below reflects exactly what Step 7 onward would submit. The
    // prompt text is fetched live rather than hardcoded, same reasoning as the file-type/
    // size messages in Step 7 below - it's just another GetTndResource-owned string that
    // can change server-side.
    if (!args.confirmed) {
      let confirmPrompt = "Are you sure you want to submit this training need?";
      try {
        const promptResource = await postJson("TNDV9/Common/GetTndResource", { resource: "TndNeedApplicationSaveConfirm" });
        if (typeof promptResource === "string" && promptResource.trim()) {
          confirmPrompt = promptResource.trim();
        }
      } catch (resourceError) {
        // Keep the fallback text above - this lookup is best-effort only.
      }

      return {
        status: "CONFIRMATION_REQUIRED",
        message: `Review this training need application with the employee before submitting. ${confirmPrompt} Call this tool again with confirmed:true (and the same arguments) once they agree.`,
        confirmationPrompt: confirmPrompt,
        preview: {
          needSelectionType: existingNeedName ? "Existing" : "New",
          needName: existingNeedName ? mainNeed.find((n) => n.needcode === needcode).needname : newNeedName,
          objective: isGoalObject ? null : finalObjective,
          linkedGoalTitle: isGoalObject ? goalTitle : null,
          relevanceToJob: relevanceToJob,
          benefitToEmployee: benefitToEmployee,
          benefitToCompany: benefitToCompany,
          attachments: attachedFiles.map((f) => ({ fileName: f.name }))
        }
      };
    }

    // Step 7: attachments (upload) - only reached once the employee has confirmed above.
    if (attachedFiles.length) {
      // PrepareNeedAttachments gates whether attachments can be added for this need
      // (tna_id/typecode) before any file is actually uploaded - confirmed live
      // (Dev in progress Features/T&D/PrepareNeedAttachments), returning
      // {IsSuccessfull, IsExceed, BudgetExceed, Message}. Bail out here rather than upload
      // files that would just be orphaned by a save the server was always going to reject.
      const prepared = await postJson("TNDV9/TrainingNeed/PrepareNeedAttachments", { tna_id: -1, typecode: typecode });
      if (!prepared || prepared.IsSuccessfull !== true || prepared.IsExceed === true) {
        return {
          status: "ERROR",
          message: (prepared && prepared.Message) || "Could not prepare attachments for this training need application."
        };
      }

      // Confirmed live (Dev in progress Features/T&D/UploadFile, UploadFile-2,
      // UploadFile-3 - repeated for 3 separate files in one application, confirmed
      // multi-attachment works via SaveNeedApplication-round2's 3-entry AttchList): each
      // file is uploaded individually as multipart/form-data with two fields - "fname" (a
      // ddMMyyyyHHmmss_ timestamp prefix plus the original file name, which becomes the
      // server-side filepath) and "file" (the binary itself) - and the endpoint responds
      // with the plain text "True" on success, not JSON. The generated fname is exactly
      // what AttchList's filepath must reference below, so it's captured once per file here.
      const uploadedEntries = [];
      for (const file of attachedFiles) {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const timestamp = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const serverFileName = `${timestamp}_${file.name}`;

        const uploadFormData = new FormData();
        uploadFormData.append("fname", serverFileName);
        uploadFormData.append("file", file, file.name);

        let uploadText = "";
        try {
          const uploadRes = await fetch(`${window.origin}/${reqOptions.sl}/TNDV9/TrainingNeed/UploadFile`, {
            method: "POST",
            headers: { "Accept": "*/*", "x-requested-with": "XMLHttpRequest" },
            body: uploadFormData
          });
          uploadText = (await uploadRes.text()).trim();
        } catch (networkError) {
          uploadText = "";
        }

        if (uploadText.toLowerCase() !== "true") {
          // No fixed max size or allowed-type list is hardcoded here - both can differ per
          // client/tenant, so the only real-time source of truth is this UploadFile call
          // itself. On rejection, the resource keys confirmed live via TNDV9/Common/
          // GetTndResource (Dev in progress Features/T&D/GetTndResource - type,
          // GetTndResource-size validation) - "TndFileTypeNotAllowed" ->
          // "File type not allowed" and "TndFileSizeExceeded" -> "Maximum file size
          // exceeded." - line up with exactly this kind of rejection, so a non-"True"
          // response is treated as one of these resource keys and translated into a
          // human-readable message. Not confirmed live that UploadFile's failure body IS
          // literally the resource key (no failing upload was captured) - if the lookup
          // comes back empty/fails, the raw response text is shown instead so nothing is
          // ever silently swallowed.
          let friendlyMessage = uploadText;
          if (uploadText) {
            try {
              const resourceMessage = await postJson("TNDV9/Common/GetTndResource", { resource: uploadText });
              if (typeof resourceMessage === "string" && resourceMessage.trim()) {
                friendlyMessage = resourceMessage.trim();
              }
            } catch (resourceError) {
              // Keep the raw uploadText - this lookup is a best-effort translation only.
            }
          }

          // Roll back whatever was already uploaded during this same call - confirmed live
          // (Dev in progress Features/T&D/DeleteFile: POST {filepath} -> true) - so a failed
          // attachment never leaves orphaned files behind on a submission that never happens.
          for (const uploaded of uploadedEntries) {
            try {
              await postJson("TNDV9/TrainingNeed/DeleteFile", { filepath: uploaded.filepath });
            } catch (cleanupError) {
              // Best-effort only - the upload itself already failed, so a failed cleanup
              // doesn't change the outcome, it just leaves a stray file server-side.
            }
          }
          return {
            status: "ERROR",
            message: `Could not upload "${file.name}"${friendlyMessage ? `: ${friendlyMessage}` : " - the server rejected this file."}`
          };
        }

        const dotIndex = file.name.lastIndexOf(".");
        uploadedEntries.push({
          attchid: uploadedEntries.length + 1,
          attchname: file.name,
          attchtype: dotIndex >= 0 ? file.name.slice(dotIndex + 1).toLowerCase() : "",
          attchfile: "",
          filepath: serverFileName
        });
      }

      attchList.push(...uploadedEntries);
    }

    // Step 8: build the outgoing EmpList entry - a specific field subset of the self
    // record (not the whole SuborList object), confirmed live by direct comparison against
    // a real submitted payload (it omits reqtypecode/editable, which SuborList itself
    // carries) - selected is always 1 for the self applicant.
    const empListEntry = {
      tna_id: selfRecord.tna_id,
      raw_id: selfRecord.raw_id,
      empno: selfRecord.empno,
      displayempno: selfRecord.displayempno,
      empname: selfRecord.empname,
      designame: selfRecord.designame,
      app_approved: selfRecord.app_approved,
      typecode: selfRecord.typecode,
      selected: 1,
      enrollstatus: selfRecord.enrollstatus,
      appid: selfRecord.appid,
      schmode: selfRecord.schmode,
      course: selfRecord.course,
      SchList: Array.isArray(selfRecord.SchList) ? selfRecord.SchList : [],
      EvalList: Array.isArray(selfRecord.EvalList) ? selfRecord.EvalList : []
    };

    // Step 9: build the submission payload - every fixed field below (needtype, status,
    // appdate/Strappdate, projectcode, supcomment, app_person, app_approved, wfmainid,
    // wfsequence, rejectcomment, centrecode, reqtypename, editable, enrollstatus, appid,
    // newneed, disableneeds, Attach, FileNameAttached) is confirmed identical across both
    // a real "existing need" and a real "new need" submission capture - newneed is always 1
    // here (it marks this as a new application RECORD, unrelated to the Existing/New Need
    // Type choice, which is typecode). Attach stays "0" and FileNameAttached stays "" even
    // when files ARE attached - confirmed live (Dev in progress Features/T&D/
    // ValidateNeedApplication, SaveNeedApplication with a real attachment): the module links
    // attachments purely through AttchList, which is now populated from Step 7 above.
    const payload = {
      tna_id: -1,
      needtype: "",
      typecode: typecode,
      needname: needname,
      needdescription: needdescription,
      status: "Pending",
      appdate: null,
      Strappdate: null,
      objective: finalObjective,
      projectcode: "",
      supcomment: "",
      app_person: "",
      app_approved: 0,
      wfmainid: "",
      wfsequence: 0,
      rejectcomment: "",
      centrecode: "",
      reltojob: relevanceToJob,
      potentialyou: benefitToEmployee,
      potentialcomp: benefitToCompany,
      needcode: needcode,
      reqtypecode: "000001",
      reqtypename: "",
      editable: 1,
      enrollstatus: "",
      appid: 0,
      newneed: 1,
      disableneeds: 0,
      Attach: "0",
      FileNameAttached: "",
      EmpList: [empListEntry],
      AttchList: attchList,
      IsGoalObject: isGoalObject,
      ExistingGoals: existingGoals,
      SelectedGoalCode: selectedGoalCode
    };

    // Step 10: validate, then save - confirmed live two-step flow
    // (New_PeoplesHR_Feature/selfEmployeeTrainingNeedApplication/applicant - {existing,new}
    // need submission.txt), same validate-then-save convention as every other write tool
    // in this build. If a save fails after attachments were uploaded, the files stay
    // uploaded server-side (nothing in the captured evidence ties a failed Save back to a
    // DeleteFile call) - only an upload failure itself triggers the Step 7 rollback above.
    const validation = await postJson("TNDV9/TrainingNeed/ValidateNeedApplication", payload);
    if (!validation || validation.IsSuccessfull !== true) {
      return {
        status: "VALIDATION_ERROR",
        message: (validation && validation.Message) || "The training need application was rejected during validation."
      };
    }

    const saveResult = await postJson("TNDV9/TrainingNeed/SaveNeedApplication", payload);
    if (!saveResult || saveResult.IsSuccessfull !== true) {
      return {
        status: "ERROR",
        message: (saveResult && saveResult.Message) || "Failed to submit the training need application."
      };
    }

    const resultEntry = (Array.isArray(saveResult.Results) && saveResult.Results[0]) || null;

    return {
      status: "SUCCESS",
      message: saveResult.Message || "Training need application submitted.",
      needSelectionType: existingNeedName ? "Existing" : "New",
      needCode: needcode,
      needName: existingNeedName ? mainNeed.find((n) => n.needcode === needcode).needname : newNeedName,
      submissionStatus: resultEntry ? resultEntry.status : null,
      attachments: attchList.map((a) => ({ fileName: a.attchname, type: a.attchtype }))
    };

  } catch (error) {
    const errorMessage = error && error.message ? error.message : String(error);
    return {
      status: "ERROR",
      message: `Failed to submit the training need application: ${errorMessage}`,
      error: errorMessage
    };
  }
})
