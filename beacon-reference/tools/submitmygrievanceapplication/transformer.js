(async function (data, args, reqOptions) {
  if (
    !BeaconBar.user?.metaData?.menus?.some(menu =>
      menu.includes("GrievanceV9/RecordGrievance/Index?type=0")
    )
  ) {
    return { error: true, message: "You do not have access to apply for grievance. Please contact HR Admin." };
  }

  // The Grievance Application screen caps Description at 200 characters (spaces included) with
  // a maxlength on the textarea, so the browser UI can never send more. Beacon bypasses that
  // control and posts straight to RecordGrievance/Submit, whose only answer to an oversized
  // description is a generic failure - so the same rule is enforced here, before any network
  // call (including attachment uploads), and the text is never silently truncated.
  const MAX_DESCRIPTION_LENGTH = 200;

  if (typeof args.description === "string" && args.description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      error: `The grievance description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters, including spaces. Please shorten the description and try again.`,
      maxLength: MAX_DESCRIPTION_LENGTH,
      currentLength: args.description.length
    };
  }

  const sourcesRes = await fetch(`${location.origin}/${reqOptions.sl}/GrievanceV9/RecordGrievance/GetGrievanceSources`, {
    method: "GET",
    headers: { "accept": "application/json, text/plain, */*" },
    redirect: "follow"
  });
  const sources = await sourcesRes.json();

  const mainGrounds = (sources || []).map(g => ({
    code: g.srcListCode,
    name: g.srcListName,
    node: g,
    subGrounds: (g.subGrievanceSources || []).map(sub => ({
      code: sub.srcListCode,
      name: sub.srcListName,
      node: sub,
      mainName: g.srcListName
    }))
  }));
  const allSubGrounds = mainGrounds.flatMap(g => g.subGrounds);

  if (!mainGrounds.length) {
    return "No grievance grounds are currently available. Please contact your HR administrator.";
  }

  function describeGrounds() {
    return mainGrounds
      .map(g => (g.subGrounds.length ? `${g.name} (${g.subGrounds.map(s => s.name).join(", ")})` : g.name))
      .join("; ");
  }

  function qualifiedName(match) {
    return match.mainName ? `${match.mainName}.${match.name}` : match.name;
  }

  function resolveGround(wantedGroundRaw) {
    const wantedGround = wantedGroundRaw.toLowerCase();
    let groundMatch;

    // "MainGround.SubGround" lets the caller disambiguate a sub-ground directly.
    if (wantedGround.includes(".")) {
      const dotIndex = wantedGround.indexOf(".");
      const wantedMain = wantedGround.slice(0, dotIndex).trim();
      const wantedSub = wantedGround.slice(dotIndex + 1).trim();
      const mainForSub = mainGrounds.find(g => g.name.toLowerCase() === wantedMain);

      if (mainForSub) {
        groundMatch = mainForSub.subGrounds.find(s => s.name.toLowerCase() === wantedSub)
          || mainForSub.subGrounds.find(s => s.name.toLowerCase().includes(wantedSub));
      }
    }

    if (!groundMatch) {
      // Only leaf-level nodes are ever matched here: main grounds without subs, plus every
      // sub-ground. A main ground that has subs is deliberately excluded - handled below.
      const leafMains = mainGrounds.filter(g => !g.subGrounds.length);
      const candidates = [...leafMains, ...allSubGrounds];

      const exact = candidates.filter(g => g.name.toLowerCase() === wantedGround);
      const matches = exact.length ? exact : candidates.filter(g => g.name.toLowerCase().includes(wantedGround));

      if (matches.length > 1) {
        return { ambiguous: matches.map(qualifiedName) };
      }

      groundMatch = matches[0];

      if (!groundMatch) {
        const parentWithSubs = mainGrounds.find(g => g.subGrounds.length && g.name.toLowerCase() === wantedGround);

        if (parentWithSubs) {
          return {
            needsSub: parentWithSubs.subGrounds.map(s => s.name),
            parentName: parentWithSubs.name
          };
        }

        return { notFound: true };
      }
    }

    return { match: groundMatch };
  }

  async function getNewGrievanceBootstrap() {
    const digestKey = await BeaconBar.executeFunction("getDigest")("type=0");

    const indexRes = await fetch(`${location.origin}/${reqOptions.sl}/GrievanceV9/RecordGrievance/Index?type=0&digest=${digestKey.digest}`, {
      method: "GET",
      headers: { "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "follow"
    });

    const indexHtml = await indexRes.text();
    const doc = new DOMParser().parseFromString(indexHtml, "text/html");

    const recHeadCode = doc.querySelector("#hdnRecHeadCode")?.value;
    const selectedEmpNumber = doc.querySelector("#hdnSelectedEmpNumber")?.value;
    const commonComEmpNumber = doc.querySelector("#hdnCommonComempNumber")?.value;

    if (!recHeadCode || !selectedEmpNumber || !commonComEmpNumber) {
      return { error: "Could not load the New Grievance page - please try again." };
    }

    const empDetailsRes = await fetch(`${location.origin}/${reqOptions.sl}/GrievanceV9/Common/GetEmployeeDetails?empNumber=${encodeURIComponent(commonComEmpNumber)}`, {
      method: "GET",
      headers: { "accept": "application/json, text/plain, */*" },
      redirect: "follow"
    });

    const empDetails = await empDetailsRes.json();

    if (!empDetails?.empNumberEncrypt) {
      return { error: "Could not resolve the logged-in employee's details - please try again." };
    }

    return {
      recHeadCode,
      selectedEmpNumber,
      createdEmpNumber: empDetails.empNumberEncrypt
    };
  }

  const bootstrap = await getNewGrievanceBootstrap();

  if (bootstrap.error) {
    return bootstrap.error;
  }

  const { recHeadCode, selectedEmpNumber, createdEmpNumber } = bootstrap;

  const jsonHeaders = new Headers();
  jsonHeaders.append("accept", "application/json, text/plain, */*");
  jsonHeaders.append("content-type", "application/json;charset=UTF-8");

  const templatesRes = await fetch(`${location.origin}/${reqOptions.sl}/GrievanceV9/RecordGrievance/GetTemplateHeads?empNumber=${encodeURIComponent(selectedEmpNumber)}`, {
    method: "GET",
    headers: { "accept": "application/json, text/plain, */*" },
    redirect: "follow"
  });

  const templates = await templatesRes.json();

  let template;

  if (args.templateName) {
    const wantedTemplate = args.templateName.toLowerCase();

    template = (templates || []).find(t => t.tempName.toLowerCase() === wantedTemplate)
      || (templates || []).find(t => t.tempName.toLowerCase().includes(wantedTemplate));

    if (!template) {
      return `Could not find a grievance template matching "${args.templateName}". Available templates: ${(templates || []).map(t => t.tempName).join(", ")}`;
    }
  } else if ((templates || []).length === 1) {
    template = templates[0];
  } else {
    return `Multiple grievance templates are available: ${(templates || []).map(t => t.tempName).join(", ")}. Ask the user which one to use and call this tool again with templateName set.`;
  }

  // Channel members depend only on the resolved template - fetched here, before ground is
  // even checked, so they are included in every response returned from this point on,
  // regardless of what else is still missing.
  const channelRes = await fetch(`${location.origin}/${reqOptions.sl}/GrievanceV9/Common/GetTemplateChannelDetails`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      tempCode: template.tempCode,
      recHeadCode: recHeadCode,
      pageName: "Application",
      grievanceEmpNumber: selectedEmpNumber
    }),
    redirect: "follow"
  });

  const channelMembers = await channelRes.json();

  const bypassWanted = (args.bypassChannelMembers || []).map(n => String(n).toLowerCase());

  (channelMembers || []).forEach(m => {
    const name = (m.empDisplayName || "").trim().toLowerCase();
    const shouldBypass = bypassWanted.some(w => name === w || name.includes(w) || m.empDisplayNumber === w);

    if (shouldBypass) {
      m.status_old = m.status;
      m.statusCSS_old = m.statusCSS;
      m.status = "Bypassed";
      m.statusCSS = "label label-bypassed";
      m.chkstatus = 1;
    }
  });

  const previewChannelMembers = (channelMembers || []).map(m => ({
    empDisplayName: (m.empDisplayName || "").trim(),
    designation: m.designation,
    priorityOrder: m.tempPriorityOrder,
    status: m.status
  }));

  if ((channelMembers || []).length && (channelMembers || []).every(m => m.status === "Bypassed")) {
    return {
      error: "You are not allowed to bypass all the channels in grievance application. At least one channel member must remain.",
      template: template.tempName,
      channelMembers: previewChannelMembers
    };
  }

  if (!args.ground) {
    return {
      message: `ground is required. Available grounds: ${describeGrounds()}`,
      template: template.tempName,
      channelMembers: previewChannelMembers
    };
  }

  const resolved = resolveGround(args.ground);

  if (resolved.ambiguous) {
    return {
      message: `More than one grievance ground matches "${args.ground}": ${resolved.ambiguous.join(", ")}. Ask the user which one and call again with the exact name (use "MainGround.SubGround" if needed).`,
      template: template.tempName,
      channelMembers: previewChannelMembers
    };
  }

  if (resolved.needsSub) {
    return {
      message: `"${resolved.parentName}" has sublevel grounds - ask the user to pick one: ${resolved.needsSub.join(", ")}.`,
      template: template.tempName,
      channelMembers: previewChannelMembers
    };
  }

  if (!resolved.match) {
    return {
      message: `Could not find a grievance ground matching "${args.ground}". Available grounds: ${describeGrounds()}`,
      template: template.tempName,
      channelMembers: previewChannelMembers
    };
  }

  const groundMatch = resolved.match;
  groundMatch.node.isChecked = true;
  const groundDisplay = qualifiedName(groundMatch);

  if (!args.summary) {
    return {
      error: "summary is required - a short summary of the grievance.",
      template: template.tempName,
      ground: groundDisplay,
      channelMembers: previewChannelMembers
    };
  }

  if (!args.description) {
    return {
      error: "description is required - the full description/details of the grievance.",
      template: template.tempName,
      ground: groundDisplay,
      channelMembers: previewChannelMembers
    };
  }

  if (!args.moodRating) {
    return {
      error: "moodRating is required - ask the user for their current mood (1-5) before submitting.",
      template: template.tempName,
      ground: groundDisplay,
      channelMembers: previewChannelMembers
    };
  }

  function uploadedFiles() {
    try {
      if (BeaconBar && typeof BeaconBar.getUploadedBaoFiles === "function") {
        const bao = BeaconBar.getUploadedBaoFiles();
        return Array.isArray(bao) ? bao.filter(Boolean) : (bao ? [bao] : []);
      }
    } catch (e) {
      // Degrade to "no files" rather than throw.
    }

    return [];
  }

  const attachedFiles = uploadedFiles();
  const attachmentTitles = args.attachmentTitles || {};

  // No attachment size or file-type limit is hardcoded here: both are configured per client
  // and enforced by RecordGrievance/AttachmentUpload itself, which answers a rejected file with
  // the module's own plain-text message (confirmed live with a 5 MB PDF: "The maximum file
  // size allowed for the Attachment is 2 MB."). That message is relayed verbatim below.

  // A title is mandatory per attachment - confirmed live (type "Grievance", key
  // "ErrorEmptyAttachmentTitleMsg": "Attachment Title cannot be empty.") - and is always
  // asked for explicitly; there is no filename-based default. Keyed by file name so
  // multiple attachments never get ambiguously matched.
  if (attachedFiles.length) {
    const missingTitles = attachedFiles
      .map(f => f.name)
      .filter(name => !attachmentTitles[name] || !String(attachmentTitles[name]).trim());

    if (missingTitles.length) {
      return {
        message: `Please provide a title for ${missingTitles.length > 1 ? "each of these attachments" : "this attachment"}: ${missingTitles.join(", ")}. Pass them in attachmentTitles, keyed by file name (e.g. {"${missingTitles[0]}": "Medical certificate"}).`,
        template: template.tempName,
        ground: groundDisplay,
        channelMembers: previewChannelMembers
      };
    }
  }

  const attachmentPreview = attachedFiles.map(f => ({
    fileName: f.name,
    title: attachmentTitles[f.name]
  }));

  if (!args.confirmed) {
    return {
      preview: true,
      message: "Review this grievance with the user before submitting. Call this tool again with confirmed:true (and the same arguments) once they agree.",
      ground: groundDisplay,
      template: template.tempName,
      summary: args.summary,
      description: args.description || "",
      hideIdentity: !!args.hideIdentity,
      moodRating: args.moodRating,
      attachments: attachmentPreview,
      channelMembers: previewChannelMembers
    };
  }

  for (const file of attachedFiles) {
    const uploadFormData = new FormData();

    uploadFormData.append("uploadFile", file, file.name);
    uploadFormData.append("fileTypedName", attachmentTitles[file.name]);
    uploadFormData.append("fileName", file.name);
    uploadFormData.append("recHeadCode", recHeadCode);

    // No content-type header here on purpose - FormData sets its own multipart boundary.
    const uploadRes = await fetch(`${location.origin}/${reqOptions.sl}/GrievanceV9/RecordGrievance/AttachmentUpload`, {
      method: "POST",
      headers: { "accept": "application/json, text/plain, */*" },
      body: uploadFormData,
      redirect: "follow"
    });

    const uploadText = (await uploadRes.text()).trim();

    if (uploadText.toLowerCase() !== "ok") {
      // The server's own message (size or file-type rejection) is shown to the user as-is,
      // so it always reflects the limits configured for this client. The grievance is not
      // submitted, and the tool can be called again once the user swaps or drops the file.
      return {
        error: `Could not attach "${file.name}": ${uploadText || "The server rejected this file."}`,
        attachmentRejected: true,
        fileName: file.name,
        template: template.tempName,
        ground: groundDisplay,
        channelMembers: previewChannelMembers
      };
    }
  }

  // Audio is optional. When disabled, this block is completely skipped and
  // the grievance Submit API proceeds normally.
  if (args?.isAudioRecorded === true || args?.isAudioRecorded === "true") {
    try {
      const audioResult = await BeaconBar.executeFunction("audioRecordFunction")(
        recHeadCode,
        `${location.origin}/${reqOptions.sl}`
      );

      if (!audioResult || audioResult.success !== true) {
 
        return {
          error: true,
          message: "Audio recording failed. Please try again."
        };
      }

    } catch (audioError) {

      return {
        error: true,
        message: "Audio recording failed. Please try again."
      };
    }
  }

  const submitRes = await fetch(`${location.origin}/${reqOptions.sl}/GrievanceV9/RecordGrievance/Submit`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      recModel: {
        recHeadCode: recHeadCode,
        tempCode: template.tempCode,
        recDesc: args.description || "",
        recSummary: args.summary,
        recHideIdentity: !!args.hideIdentity,
        createdEmpNumber: createdEmpNumber,
        emojiRating: args.moodRating,
        channelmems: channelMembers
      },
      sources: sources
    }),
    redirect: "follow"
  });

  const submitText = (await submitRes.text()).trim();

  if (submitText.toLowerCase() !== "ok") {
    return `Submit did not succeed: ${submitText || "(empty response)"}`;
  }

  let attachmentsResult = attachmentPreview;

  if (attachedFiles.length) {
    try {
      const attListRes = await fetch(`${location.origin}/${reqOptions.sl}/GrievanceV9/RecordGrievance/GetAttachmentLists`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          recHeadCode: recHeadCode
        }),
        redirect: "follow"
      });

      const attList = await attListRes.json();

      if (Array.isArray(attList)) {
        attachmentsResult = attList.map(a => ({
          attId: a.attId,
          fileName: a.attName,
          title: a.attDescription
        }));
      }
    } catch (e) {
      // Keep the locally-known list if this verification call itself fails - the uploads
      // already succeeded above, so this is a display-only fallback, not a submission risk.
    }
  }

  return {
    submitted: true,
    recHeadCode: recHeadCode,
    ground: groundDisplay,
    template: template.tempName,
    summary: args.summary,
    description: args.description || "",
    hideIdentity: !!args.hideIdentity,
    moodRating: args.moodRating || null,
    attachments: attachmentsResult,
    channelMembers: previewChannelMembers
  };
})