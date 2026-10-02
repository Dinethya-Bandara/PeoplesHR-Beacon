(async function (data, args, reqOptions) {
  if (
    !BeaconBar.user?.metaData?.menus?.some(menu =>
      menu.includes("GrievanceV9/GrievanceHistorySummary")
    )
  ) {
    return { error: true, message: "You do not have access to view grievance history. Please contact HR Admin." };
  }

  async function readJson(response, label) {
    const text = await response.text();
    try {
      return { data: JSON.parse(text) };
    } catch (e) {
      return { error: `${label} did not return JSON (HTTP ${response.status}). First 300 chars of response: ${text.slice(0, 300)}` };
    }
  }

  if (!args.originalRecHeadCode) return "Error: originalRecHeadCode is required - the recHeadCode of the grievance being appealed, from getMyGrievanceHistory.";
  if (!args.originalEmpNumber) return "Error: originalEmpNumber is required - the empNumber of that grievance, from the same getMyGrievanceHistory result.";
  if (!args.originalTempHeadCode) return "Error: originalTempHeadCode is required - the tempHeadCode of that grievance, from the same getMyGrievanceHistory result.";
  if (!args.comment) return "Error: comment is required - the employee's comment/reason for appealing this grievance.";

  const jsonHeaders = new Headers();
  jsonHeaders.append("accept", "application/json, text/plain, */*");
  jsonHeaders.append("content-type", "application/json;charset=UTF-8");

  const indexParams = `oriHeadCode=${args.originalRecHeadCode}&oriEmpNumber=${encodeURIComponent(args.originalEmpNumber)}`;
  const digestKey = await BeaconBar.executeFunction("getDigest")(indexParams);
  const indexRes = await fetch(`${location.origin}/${reqOptions.sl}/GrievanceV9/AppealGrievance/Index?${indexParams}&digest=${digestKey.digest}`, {
    method: "GET",
    headers: { "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    redirect: "follow"
  });
  const indexHtml = await indexRes.text();
  const doc = new DOMParser().parseFromString(indexHtml, "text/html");
  // newRecHeadCode (the plain appeal head code, e.g. "001865") is distinct from the
  // composite `recHeadCode` computed below (e.g. "001865-000262-000262"). Confirmed live:
  // AttachmentUpload/GetAttachmentLists key off this plain value; only Submit uses the
  // composite one. Keep both in scope - never substitute one for the other.
  const newRecHeadCode = doc.querySelector("#hdnRecHeadCode")?.value;

  if (!newRecHeadCode) {
    return `Could not read a new appeal recHeadCode from the Appeal page load (HTTP ${indexRes.status}). AppealGrievance/Index's markup may differ from RecordGrievance/Index's #hdnRecHeadCode field - this needs a real capture of that page's response to confirm. First 300 chars of response: ${indexHtml.slice(0, 300)}`;
  }

  const recHeadCode = `${newRecHeadCode}-${args.originalRecHeadCode}-${args.originalRecHeadCode}`;

  const channelRes = await fetch(`${location.origin}/${reqOptions.sl}/GrievanceV9/Common/GetTemplateChannelDetails`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      tempCode: args.originalTempHeadCode,
      recHeadCode: args.originalRecHeadCode,
      pageName: "Appeal",
      grievanceEmpNumber: args.originalEmpNumber
    }),
    redirect: "follow"
  });
  const channelResult = await readJson(channelRes, "GetTemplateChannelDetails");
  if (channelResult.error) return channelResult.error;
  const channelMembers = channelResult.data;

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

  // Attachments are optional (UAC 4.4) and come only from the Beacon chat's own upload
  // mechanism - same source every other tool in this org reads from. Guarded so a host
  // without the helper degrades to "no files" rather than throw.
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

  // Local, immediate size check - so the employee finds out the moment they attach an
  // oversized file, not only after confirming. Heuristic only, not authoritative: 2 MB is
  // the limit confirmed live for grievance attachments (type "Grievance", key unconfirmed
  // for this specific endpoint) - inherited here since the same module governs both, but
  // not independently confirmed for AppealGrievance/AttachmentUpload. A file under 2MB
  // still goes through the real AttachmentUpload call below, which remains authoritative.
  const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
  const oversizedFiles = attachedFiles.filter(f => typeof f.size === "number" && f.size > MAX_ATTACHMENT_BYTES);
  if (oversizedFiles.length) {
    return {
      message: `${oversizedFiles.map(f => `"${f.name}" is ${(f.size / (1024 * 1024)).toFixed(1)} MB`).join(", ")} - the maximum attachment size is 2 MB. Ask the user to attach a smaller file instead, or continue without it.`,
      originalRecHeadCode: args.originalRecHeadCode,
      comment: args.comment,
      hideIdentity: !!args.hideIdentity,
      channelMembers: previewChannelMembers
    };
  }

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
        originalRecHeadCode: args.originalRecHeadCode,
        comment: args.comment,
        hideIdentity: !!args.hideIdentity,
        channelMembers: previewChannelMembers
      };
    }
  }

  const attachmentPreview = attachedFiles.map(f => ({ fileName: f.name, title: attachmentTitles[f.name] }));

  if (!args.confirmed) {
    return {
      preview: true,
      message: "Review this appeal with the user before submitting. Call this tool again with confirmed:true (and the same arguments) once they agree.",
      originalRecHeadCode: args.originalRecHeadCode,
      comment: args.comment,
      hideIdentity: !!args.hideIdentity,
      attachments: attachmentPreview,
      channelMembers: previewChannelMembers
    };
  }

  // Attachments are uploaded before Submit, one file per call - the only shape this
  // endpoint accepts (single uploadFile + fileTypedName + fileName + recHeadCode per POST,
  // plain-text "OK" on success - confirmed live). Uses newRecHeadCode (the plain value),
  // NOT the composite recHeadCode used below for Submit - confirmed by a same-session
  // capture showing AttachmentUpload/GetAttachmentLists keyed to the plain value while
  // Submit used the composite one. If any single upload fails, stop here and relay its
  // exact server message - Submit is never called, so a partially-attached appeal is
  // never created. No file type/size is pre-validated client-side beyond the size
  // heuristic above; whatever the server says at upload time is the only other truth.
  for (const file of attachedFiles) {
    const uploadFormData = new FormData();
    uploadFormData.append("uploadFile", file, file.name);
    uploadFormData.append("fileTypedName", attachmentTitles[file.name]);
    uploadFormData.append("fileName", file.name);
    uploadFormData.append("recHeadCode", newRecHeadCode);

    // No content-type header here on purpose - FormData sets its own multipart boundary.
    const uploadRes = await fetch(`${location.origin}/${reqOptions.sl}/GrievanceV9/AppealGrievance/AttachmentUpload`, {
      method: "POST",
      headers: { "accept": "application/json, text/plain, */*" },
      body: uploadFormData,
      redirect: "follow"
    });
    // Deliberately not stripping wrapping quotes here (unlike the Submit check below) -
    // the captured AttachmentUpload response is a bare, unquoted "OK", identical in shape
    // to the grievance module's own. Generalizing Submit's quote-strip to this endpoint
    // without evidence risks masking a genuinely different failure mode; if this endpoint
    // ever does return a quoted "OK", the check below simply fails closed (treated as a
    // rejection and surfaced to the user) rather than silently accepting it.
    const uploadText = (await uploadRes.text()).trim();
    if (uploadText.toLowerCase() !== "ok") {
      return {
        error: `Could not attach "${file.name}": ${uploadText || "(empty response)"}`,
        originalRecHeadCode: args.originalRecHeadCode,
        comment: args.comment,
        hideIdentity: !!args.hideIdentity,
        channelMembers: previewChannelMembers
      };
    }
  }

  // appealrefcode: "1" is the exact literal value seen in the one captured Submit call.
  // It may actually need to be the sequential appeal-attempt number (getMyAppealHistory
  // exposes attemptsUsed for an existing appeal) rather than always "1" - kept as the
  // captured value rather than guessing a formula with no second example to check it against.
  const submitRes = await fetch(`${location.origin}/${reqOptions.sl}/GrievanceV9/AppealGrievance/Submit`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      recModel: {
        recHeadCode: recHeadCode,
        tempCode: args.originalTempHeadCode,
        recDesc: args.comment,
        recSummary: "",
        recHideIdentity: !!args.hideIdentity,
        createdEmpNumber: args.originalEmpNumber,
        appealrefcode: "1",
        channelmems: channelMembers
      }
    }),
    redirect: "follow"
  });

  // Submit does not return JSON - confirmed by the capture: a successful call returns the
  // plain text OK (HTTP 200), same as GrievanceV9/RecordGrievance/Submit.
  const submitText = (await submitRes.text()).trim().replace(/^['"]|['"]$/g, "");
  if (!submitRes.ok || submitText.toLowerCase() !== "ok") {
    return `Appeal submission did not succeed (HTTP ${submitRes.status}): ${submitText || "(empty response)"}`;
  }

  // Round-trip once against the module's own attachment list rather than trusting our own
  // upload calls did exactly what was intended - authoritative names/ids for the response.
  // Uses newRecHeadCode (plain), matching the confirmed GetAttachmentLists capture.
  let attachmentsResult = attachmentPreview;
  if (attachedFiles.length) {
    try {
      const attListRes = await fetch(`${location.origin}/${reqOptions.sl}/GrievanceV9/AppealGrievance/GetAttachmentLists`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ recHeadCode: newRecHeadCode }),
        redirect: "follow"
      });
      const attList = await attListRes.json();
      if (Array.isArray(attList)) {
        attachmentsResult = attList.map(a => ({ attId: a.attId, fileName: a.attName, title: a.attDescription }));
      }
    } catch (e) {
      // Keep the locally-known list if this verification call itself fails - the uploads
      // already succeeded above, so this is a display-only fallback, not a submission risk.
    }
  }

  return {
    submitted: true,
    originalRecHeadCode: args.originalRecHeadCode,
    comment: args.comment,
    hideIdentity: !!args.hideIdentity,
    attachments: attachmentsResult,
    channelMembers: previewChannelMembers
  };
})