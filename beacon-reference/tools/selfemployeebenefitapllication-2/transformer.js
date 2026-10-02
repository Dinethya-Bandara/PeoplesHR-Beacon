(async function (data, args, reqOptions) {
  /* Anything this tool throws would otherwise reach the user as Beacon's
   * generic "Something went wrong. Please try again later.", which says
   * nothing about what failed. The stage is tracked as the run proceeds and
   * reported with the error, so a failure can be placed exactly. */
  let toolStage = "starting";
  try {

    /* PeoplesHR bes_ctrl_type codes. Confirmed with IE as globally valid across
     * every benefit type, so they are safe to hardcode:
     *   "1" - Text Box
     *   "2" - Numeric
     *   "3" - Dropdown
     *   "4" - Checkbox
     *   "5" - Date Picker
     *   "7" - Label      (display only, never an input)
     *   "8" - Text Area
     * "VL" is not one of them: it is the screen's computed Total Request, which
     * carries no BesDisplayName and is handled separately below.
     *
     * Every code except "7" and "VL" is something the user fills in, so all of
     * them belong in this list. A code left out of it is dropped from the form
     * altogether - that is how the eleven "8" (Text Area) controls on SSS-
     * Sickness Benefits went missing until PeoplesHR refused the save. */
    const EDITABLE_CTRL_TYPES = ["1", "2", "3", "4", "5", "8"];
    const DEFAULT_DATE_FORMAT = "DD/MM/YYYY";

    const benefitHeaders = new Headers();
    benefitHeaders.append("Accept", "application/json, text/javascript, */*; q=0.01");
    benefitHeaders.append("Content-Type", "application/json; charset=UTF-8");
    benefitHeaders.append("X-Requested-With", "XMLHttpRequest");

    const base = `${location.origin}/${reqOptions.sl}`;

    /* ---------------------------------------------------------------------
     * Step 0: permission gate, before any request. The self Benefit Application
     * menu entry is
     *   ../Benefitv9/Application/Application/?mvc=1&bs=4&digest=...
     * with no mode parameter - which is exactly what separates it from the team
     * screen's ?mode=0&mvc=1, so matching on "application/?mvc=1" cannot be
     * satisfied by team access alone. The per-session digest is not matched on.
     * ------------------------------------------------------------------- */
    if (
      !BeaconBar.user?.metaData?.menus?.some(menu =>
        menu.includes("Benefitv9/Application/Application")
      )
    ) {
      return { error: true, message: "You do not have access to apply for Benefit Application screen. Please contact HR Admin." };
    }

    /* ---------------------------------------------------------------------
     * Generic helpers
     * ------------------------------------------------------------------- */
    async function readJson(response, label) {
      const text = await response.text();
      try {
        return { data: JSON.parse(text) };
      } catch (e) {
        return { error: `${label} did not return usable data (HTTP ${response.status}). First 300 chars: ${text.slice(0, 300) || "(empty response)"}` };
      }
    }

    async function postJson(url, body, label) {
      const res = await fetch(url, {
        method: "POST",
        headers: benefitHeaders,
        body: JSON.stringify(body),
        redirect: "follow"
      });
      return readJson(res, label);
    }

    // Short stable fingerprint, used to bind a preview to the submit that follows.
    function digestOf(value) {
      const text = JSON.stringify(value);
      let h = 5381;
      for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
      return h.toString(36);
    }

    function numberOf(value) {
      const num = parseFloat(String(value == null ? "" : value).replace(/,/g, ""));
      return isNaN(num) ? null : num;
    }

    // Multipart POST. No Content-Type here on purpose - FormData sets its own
    // multipart boundary.
    async function postForm(url, formData, label) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Accept": "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" },
        body: formData,
        redirect: "follow"
      });
      return readJson(res, label);
    }

    // Files the user attached in the chat. Degrades to "no files" rather than
    // throwing when the Beacon helper is unavailable.
    // Records how the chat files were read, so a response that reports no
    // attachment can be told apart from the helper being missing or throwing.
    const chatFileSource = {
      helperPresent: false,
      filesSeen: 0,
      readError: null
    };

    function chatFiles() {
      try {
        chatFileSource.helperPresent =
          typeof BeaconBar !== "undefined" &&
          typeof BeaconBar.getUploadedBaoFiles === "function";

        let uploaded = [];

        if (chatFileSource.helperPresent) {
          const bao = BeaconBar.getUploadedBaoFiles();
          uploaded = Array.isArray(bao) ? bao : bao ? [bao] : [];
        }

        // Read files collected by the separate attachment collector.
        let collected = [];
        if (typeof BeaconBar.getSharedData === "function") {
          const stored = BeaconBar.getSharedData("peoplesHRChatAttachments");
          collected = Array.isArray(stored) ? stored : stored ? [stored] : [];

          const selected = BeaconBar.getSharedData("peoplesHRSelectedAttachment");
          if (selected && !collected.some(f =>
            f === selected
          )) {
            collected.push(selected);
          }
        }

        // Merge current chat uploads with previously collected attachments.
        const combined = [...collected, ...uploaded]
          .filter(f => f && typeof f === "object" && f.name);

        // For duplicate names, prefer the current chat upload.
        const unique = combined.filter((f, i, list) =>
          list.findLastIndex(o =>
            String(o.name).toLowerCase() === String(f.name).toLowerCase()
          ) === i
        );

        chatFileSource.filesSeen = unique.length;
        return unique;
      } catch (e) {
        chatFileSource.readError = String((e && e.message) || e);
        return [];
      }
    }
    /* The file the chat hands over is not always a Blob. Confirmed live:
     * UploadAttachment threw "parameter 2 is not of type 'Blob'" when
     * BeaconBar.getUploadedBaoFiles() returned a wrapper describing the file
     * rather than the file itself. Whatever arrives - a File, a wrapper holding
     * one, raw bytes, a base64 string, a data: URL or a link - is turned into a
     * Blob here, so the upload posts real content instead of throwing. */
    function base64ToBlob(text, type) {
      const clean = String(text).replace(/^data:[^,]*,/, "").replace(/\s/g, "");
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], type ? { type: type } : undefined);
    }

    async function fileBlobOf(entry) {
      if (!entry) return null;
      const name = String(entry.name || entry.fileName || entry.filename || entry.FileName || "attachment");
      const type = entry.type || entry.mimeType || entry.contentType || "";
      const wrap = blob => ({ blob: blob, name: name, size: blob.size });

      if (typeof Blob !== "undefined" && entry instanceof Blob) return wrap(entry);

      const nested = entry.file || entry.blob || entry.rawFile || entry.originFileObj || entry.fileObject || entry.baoFile;
      if (nested && typeof Blob !== "undefined" && nested instanceof Blob) {
        return { blob: nested, name: nested.name || name, size: nested.size };
      }
      if (typeof entry.arrayBuffer === "function") {
        return wrap(new Blob([await entry.arrayBuffer()], type ? { type: type } : undefined));
      }

      const raw = entry.base64 || entry.base64Data || entry.Base64Data || entry.content || entry.fileData
        || entry.data || entry.bytes || entry.buffer || entry.url || entry.src || entry.fileUrl || entry.downloadUrl;
      if (raw && (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw))) {
        return wrap(new Blob([raw], type ? { type: type } : undefined));
      }
      if (typeof raw === "string" && raw) {
        if (/^https?:\/\//i.test(raw) || raw.charAt(0) === "/") {
          const res = await fetch(raw, { redirect: "follow" });
          return wrap(await res.blob());
        }
        try { return wrap(base64ToBlob(raw, type)); } catch (e) { return null; }
      }
      return null;
    }

    // Named so an unresolvable entry can say what it did arrive with.
    function describeEntry(entry) {
      try { return Object.keys(entry || {}).join(", ") || typeof entry; } catch (e) { return typeof entry; }
    }

    function extensionOf(name) {
      const dot = String(name).lastIndexOf(".");
      return dot >= 0 ? String(name).slice(dot + 1).toLowerCase() : "";
    }

    function sizeInMb(bytes) {
      return typeof bytes === "number" ? +(bytes / (1024 * 1024)).toFixed(2) : null;
    }

    /* ---------------------------------------------------------------------
     * Step 1: bootstrap the Benefit Application page and scrape
     * window.BenefitApplicationObj. Everything this tool needs about the
     * signed-in employee is in that blob - CurrentEmployeeNumber (their
     * encrypted token), KeyValue, AppId, BetAppYear and BmBenefitTypes (the
     * types they may apply for) - which is why there is no employee lookup here
     * at all. Nothing is cached on `window` between calls: every invocation
     * re-resolves everything fresh.
     * ------------------------------------------------------------------- */
    const updateUrl = await BeaconBar.executeFunction("updateUrlParams")("Benefitv9/Application/Application/?mvc=1");
    if (!updateUrl || !updateUrl.updateUrl) {
      return "Could not resolve the Benefit Application screen from your menu. Please try again, or check with the HR Admin.";
    }

    const pageDigest = await BeaconBar.executeFunction("getDigest")(updateUrl.updateParams);
    const pageUrl = `${base}/${updateUrl.updateUrl}&digest=${pageDigest.digest}`;

    toolStage = "opening the Benefit Application screen";
    const pageRes = await fetch(pageUrl, {
      method: "GET",
      headers: { "accept": "*/*", "accept-language": "en-US,en;q=0.9" },
      redirect: "follow"
    });
    const pageHtml = await pageRes.text();

    const blobMatch = pageHtml.match(/window\.BenefitApplicationObj\s*=\s*'([\s\S]*?)';/);
    let blob = null;
    if (blobMatch) {
      try { blob = JSON.parse(blobMatch[1]); } catch (e) { blob = null; }
    }

    if (!blob || !blob.CurrentEmployeeNumber || !blob.KeyValue) {
      return `Could not initialize the Benefit Application page (HTTP ${pageRes.status}) - please try again.`;
    }

    // The tenant's own date format, straight off the screen (window.$MomentDateFormat
    // = 'DD/MM/YYYY' in the capture). Assuming DD/MM/YYYY would silently accept
    // 09/16/2026 and post it as 9 September in a DD/MM tenant.
    const formatMatch = pageHtml.match(/window\.\$MomentDateFormat\s*=\s*'([^']+)'/);
    const dateFormat = (formatMatch && formatMatch[1]) || DEFAULT_DATE_FORMAT;
    const dateRegex = new RegExp("^" + dateFormat
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/DD/g, "\\d{2}")
      .replace(/MM/g, "\\d{2}")
      .replace(/YYYY/g, "\\d{4}") + "$");

    function todayFormatted() {
      const d = new Date();
      const pad = n => String(n).padStart(2, "0");
      return dateFormat
        .replace(/DD/g, pad(d.getDate()))
        .replace(/MM/g, pad(d.getMonth() + 1))
        .replace(/YYYY/g, String(d.getFullYear()));
    }

    /* ---------------------------------------------------------------------
     * Step 2: the applicant is the signed-in employee - no search, no choosing.
     * The page's own KeyValue is used as the application-session key: unlike the
     * team screen, nothing switches employee mid-session, so the key the page was
     * issued with is the right one (and is what the live self tool has always
     * used successfully).
     *
     * Attachments are staged on the server under this key before the user
     * confirms, so a key handed back from an earlier preview
     * (attachmentSessionKey) is reused - otherwise files staged in one call
     * would not be found by the next.
     * ------------------------------------------------------------------- */
    const employeeDetails = blob.Employee || {};
    const employee = {
      empNumber: blob.CurrentEmployeeNumber,
      displayNumber: (employeeDetails.EmpDisplayNumber || "").trim(),
      displayName: (employeeDetails.EmpDisplayName || "").trim() || "you"
    };
    const appEmpNumber = employee.empNumber;

    /* ---------------------------------------------------------------------
     * Step 3: the benefit types this employee may apply for, from the blob the
     * page was rendered with.
     * ------------------------------------------------------------------- */
    const benefitTypes = (blob.BmBenefitTypes || [])
      .map(x => ({ BetCode: x.BetCode, BetName: x.BetName }))
      .filter(x => x.BetCode && x.BetName);

    if (benefitTypes.length === 0) {
      return "You have no benefit types available to apply for. Please check the benefit setup with HR Admin.";
    }

    const availableTypes = benefitTypes.map(b => b.BetName);

    if (!args.benefitType) {
      return {
        needsInput: true,
        message: `The signed-in user is identified as ${employee.displayName}${employee.displayNumber ? ` (${employee.displayNumber})` : ""} - do not ask them for an employee ID. Show them the availableBenefitTypes list below exactly as it is and ask which one they want to apply for. These are the only types they can apply for: they come from their own Benefit Application screen, not from masterDataTypes (that tool lists HR admin master-data categories, not what an employee may claim), and never from general knowledge.`,
        employee: employee.displayName,
        employeeNumber: employee.displayNumber,
        designation: (employeeDetails.Designation && employeeDetails.Designation.DsgName) || null,
        availableBenefitTypes: availableTypes
      };
    }

    /* ---------------------------------------------------------------------
     * Step 4: resolve the benefit type. An ambiguous partial name asks rather
     * than silently taking the first match - each call re-resolves from scratch,
     * so a silent pick could differ between the preview and the submit.
     * ------------------------------------------------------------------- */
    const wantedType = args.benefitType.toLowerCase().trim();
    const exactType = benefitTypes.filter(b => b.BetName.toLowerCase() === wantedType);
    const partialTypes = benefitTypes.filter(b => b.BetName.toLowerCase().includes(wantedType));
    const typeCandidates = exactType.length > 0 ? exactType : partialTypes;

    if (typeCandidates.length === 0) {
      return {
        needsInput: true,
        validationError: true,
        message: `"${args.benefitType}" is not one of the benefit types ${employee.displayName} can apply for. Tell the user that plainly, then show them the availableBenefitTypes list below exactly as it is and ask which one they meant - do not suggest any type that is not on it.`,
        employee: employee.displayName,
        employeeNumber: employee.displayNumber,
        availableBenefitTypes: availableTypes
      };
    }
    if (typeCandidates.length > 1) {
      return {
        needsInput: true,
        message: `"${args.benefitType}" matches more than one of your benefit types. Ask the user which one they mean, using the exact names below.`,
        employee: employee.displayName,
        candidates: typeCandidates.map(b => b.BetName)
      };
    }

    const typeMatch = typeCandidates[0];

    /* A staging key that is the same on every call of one application. The
     * Benefit Application page mints a FRESH KeyValue each time it loads
     * (confirmed by capture: four page loads, four different GUIDs), and this
     * tool re-loads that page on every call - so a key taken from the page, or a
     * freshly minted one, points at a different, empty staging slot each time.
     * Files staged while building the preview were then invisible at the confirm
     * unless the agent passed attachmentSessionKey back, and the tool reported
     * having no attachment although the user had attached one.
     *
     * The encrypted CurrentEmployeeNumber is re-encrypted on every page load, so
     * the employee is identified here by their plain display number instead.
     * Deriving it from the employee and the benefit type keeps it stable without
     * any state: the same application always resolves to the same key, and a
     * different employee or benefit type gets its own. attachmentSessionKey, when
     * the agent does pass it, still wins.
     */
    function stableSessionKey(seed) {
      const blocks = [];
      for (let i = 0; i < 4; i++) {
        const text = seed + "|" + i;
        let h = (5381 + i * 7919) >>> 0;
        for (let j = 0; j < text.length; j++) h = ((h << 5) + h + text.charCodeAt(j)) >>> 0;
        blocks.push(("00000000" + h.toString(16)).slice(-8));
      }
      const hex = blocks.join("");
      // Shaped like the GUIDs the screen itself uses.
      return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(13, 16)
        + "-a" + hex.slice(17, 20) + "-" + hex.slice(20, 32);
    }

    const sessionKey = (args.attachmentSessionKey && String(args.attachmentSessionKey).trim())
      || stableSessionKey((employee.displayNumber || employee.displayName) + "|" + typeMatch.BetCode);

    /* ---------------------------------------------------------------------
     * Step 5: the application structure for this benefit type.
     * ------------------------------------------------------------------- */
    toolStage = "loading the benefit type's form";
    const structureResult = await postJson(
      `${base}/BenefitV9/api/ApplicationApi/GetApplicationStructure/`,
      {
        betCode: typeMatch.BetCode,
        empNumber: appEmpNumber,
        visibilityState: blob.VisibilityState || "1",
        isWorkflow: blob.IsWorkflow || "0",
        appId: blob.AppId,
        wfMainId: blob.WfMainId || null,
        cancelWfMainId: blob.CancelWfMainId || null,
        keyValue: sessionKey,
        BetAppYear: blob.BetAppYear
      },
      "GetApplicationStructure"
    );
    if (structureResult.error) return structureResult.error;

    const structure = structureResult.data;
    if (!structure || !structure.applicationRowVms) {
      return `Could not load the "${typeMatch.BetName}" application form for ${employee.displayName}. Please try again, or use the Benefit Management screen directly.`;
    }

    const betInfo = structure.currentBenefitType || {};

    /* ---------------------------------------------------------------------
     * Attachment settings, straight off currentBenefitType. They differ per
     * benefit type and per client (backend key), so nothing is hardcoded and no
     * separate network call is made to validate type or size:
     *   BetHasAttachment          "1" = attachments accepted
     *   BetAttachmentMandatoryFlg "1" = at least one attachment required
     *   BetAttachmentFileTypes    e.g. ["pdf","txt","doc","docx"]
     *   MaxAttachmentSize         per-file limit in MB, e.g. "1"
     *   BetMaxAttachmentCount     optional cap on the number of files
     * ------------------------------------------------------------------- */
    const rawFileTypes = Array.isArray(betInfo.BetAttachmentFileTypes)
      ? betInfo.BetAttachmentFileTypes
      : String(betInfo.BetAttachmentFileTypes || "").split(",");
    const attachmentRules = {
      allowed: String(betInfo.BetHasAttachment) === "1" || String(betInfo.BetAttachmentMandatoryFlg) === "1",
      mandatory: String(betInfo.BetAttachmentMandatoryFlg) === "1",
      allowedTypes: rawFileTypes.map(t => String(t).trim().replace(/^\./, "").toLowerCase()).filter(Boolean),
      maxSizeMb: numberOf(betInfo.MaxAttachmentSize) > 0 ? numberOf(betInfo.MaxAttachmentSize) : null,
      maxCount: numberOf(betInfo.BetMaxAttachmentCount) > 0 ? numberOf(betInfo.BetMaxAttachmentCount) : null
    };

    function attachmentRulesText() {
      const parts = [];
      if (attachmentRules.allowedTypes.length) parts.push(`allowed file types: ${attachmentRules.allowedTypes.join(", ")}`);
      if (attachmentRules.maxSizeMb) parts.push(`maximum ${attachmentRules.maxSizeMb} MB per file`);
      if (attachmentRules.maxCount) parts.push(`at most ${attachmentRules.maxCount} file(s)`);
      return parts.join("; ");
    }

    const removeNames = (Array.isArray(args.removeAttachments) ? args.removeAttachments : (args.removeAttachments ? [args.removeAttachments] : []))
      .map(n => String(n).trim().toLowerCase())
      .filter(Boolean);
    const isRemoved = name => removeNames.includes(String(name || "").trim().toLowerCase());

    const attachmentBase = { attachmentRules, attachmentSessionKey: sessionKey };
    const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
    let stagedAttachments = [];
    const attachmentNotes = [];
    // Every file the user attached that PeoplesHR will not take, with the
    // reason - reported on its own so it is never lost in the note text.
    const rejectedAttachments = [];
    // Files named in removeAttachments that were never on the application:
    // there was nothing to remove, so the name can only have cancelled a file
    // the user attached in the chat.
    const suppressedByRemoval = [];
    // Files kept although removeAttachments named them, because the benefit
    // type requires an attachment and nothing else was left.
    const keptDespiteRemoval = [];

    const listAttachments = async () => {
      const result = await postJson(
        `${base}/BenefitV9/api/ApplicationApi/GetAttachments`,
        { empNumber: appEmpNumber, key: sessionKey },
        "GetAttachments"
      );
      if (result.error) return { error: result.error };
      return { list: (result.data && result.data.BmAppAttachments) || [] };
    };

    /* Files are staged on the server as soon as this tool sees them, on ANY
     * call - including the one that only lists the fields. The chat helper
     * reports a file to the call it was attached for; by the next call it can
     * report nothing, so a file that is merely noticed and not uploaded is
     * lost. Staging it immediately, under a key that is the same for every
     * call of this application, means later calls find it on the server
     * instead of asking the user for a document they already attached.
     * Returns a response to hand straight back, or null to carry on. */
    let attachmentsSynced = false;

    async function syncAttachments() {
      toolStage = "reading the attachments already on the application";
      if (attachmentsSynced) return null;
      attachmentsSynced = true;
      if (!attachmentRules.allowed) {
        const unexpected = chatFiles().filter(f => !isRemoved(f.name));
        if (unexpected.length > 0) {
          return {
            needsInput: true,
            message: `The "${typeMatch.BetName}" benefit type does not accept attachments, but ${unexpected.map(f => `"${f.name}"`).join(", ")} ${unexpected.length === 1 ? "is" : "are"} attached in the chat. Nothing has been uploaded or submitted. Tell the user, and if they want to continue without ${unexpected.length === 1 ? "it" : "them"}, call this tool again with the same arguments plus removeAttachments listing ${unexpected.length === 1 ? "that file name" : "those file names"}.`,
            attachmentsNotAccepted: unexpected.map(f => f.name)
          };
        }
      } else {
        const current = await listAttachments();
        if (current.error) return current.error;
        let serverList = current.list;

        const inChat = chatFiles();
        const toDelete = serverList.filter(a => isRemoved(a.BetAttachmentName));

        /* Anything the chat hands over is an upload attempt. The helper reports
         * a file to the call it was attached for, so a file arriving under a
         * name that is already on the application is the user replacing it
         * with a newer version - the staged copy is deleted and the new one
         * uploaded, rather than skipped as a duplicate. Nothing in the staged
         * list says how big a file is or when it changed, so the chat is the
         * only thing that can be trusted about what the user wants now. */
        const replaced = serverList.filter(a => !isRemoved(a.BetAttachmentName)
          && inChat.some(f => !isRemoved(f.name) && sameName(f.name, a.BetAttachmentName)));
        /* "Change the document to this": with replaceAttachments the files in
         * the chat are the whole attachment list, so anything staged that the
         * user did not attach again comes off - a swap for a file with a
         * different name is a replacement too, not a second attachment. It
         * only applies when there is something to put in their place, so the
         * flag can never empty an application on its own. */
        const replacingAll = args.replaceAttachments === true || String(args.replaceAttachments || "").toLowerCase() === "true";
        const supersededByReplaceAll = (replacingAll && inChat.some(f => !isRemoved(f.name)))
          ? serverList.filter(a => !isRemoved(a.BetAttachmentName)
            && !inChat.some(f => sameName(f.name, a.BetAttachmentName))
            && !replaced.some(r => sameName(r.BetAttachmentName, a.BetAttachmentName)))
          : [];
        const toRemoveFromServer = toDelete.concat(replaced, supersededByReplaceAll);
        const toUpload = inChat.filter(f => !isRemoved(f.name));
        inChat.forEach(f => {
          if (!isRemoved(f.name) || serverList.some(a => sameName(a.BetAttachmentName, f.name))) return;
          const wrongType = attachmentRules.allowedTypes.length && !attachmentRules.allowedTypes.includes(extensionOf(f.name));
          const tooBig = attachmentRules.maxSizeMb && typeof f.size === "number" && f.size > attachmentRules.maxSizeMb * 1024 * 1024;
          if (!wrongType && !tooBig) suppressedByRemoval.push(f.name);
        });

        /* Local validation only - no network call - before anything is changed.
         * Each file is judged on its own: the chat helper hands back EVERY file
         * attached during the session, so one the server would refuse stays in that
         * list for the rest of the conversation. Refusing the whole call because of
         * it meant a supported file attached afterwards could never be uploaded -
         * the user kept being asked for a document they had already attached.
         * Unusable files are skipped and reported instead. */
        const usable = toUpload.filter(f => {
          if (attachmentRules.allowedTypes.length && !attachmentRules.allowedTypes.includes(extensionOf(f.name))) {
            rejectedAttachments.push({ name: f.name, reason: `its file type is not accepted for "${typeMatch.BetName}" (allowed: ${attachmentRules.allowedTypes.join(", ")})` });
            return false;
          }
          if (attachmentRules.maxSizeMb && typeof f.size === "number" && f.size > attachmentRules.maxSizeMb * 1024 * 1024) {
            rejectedAttachments.push({ name: f.name, reason: `it is ${sizeInMb(f.size)} MB and the maximum for "${typeMatch.BetName}" is ${attachmentRules.maxSizeMb} MB` });
            return false;
          }
          return true;
        });

        // Nothing usable anywhere: only then is there something to go back for.
        if (rejectedAttachments.length > 0 && usable.length === 0 && serverList.length - toDelete.length === 0) {
          return Object.assign({
            needsInput: true,
            validationError: true,
            missingFields: attachmentRules.mandatory ? ["Attachment"] : undefined,
            rejectedAttachments,
            message: `${rejectedAttachments.map(r => `"${r.name}" cannot be attached because ${r.reason}`).join("; ")}. Nothing has been uploaded or submitted. Tell the user this exactly and ask them to attach a supported file in the chat. Do NOT put the file this tool refused in removeAttachments - it is skipped by itself, and removeAttachments is only for files already on the application that the user wants taken off. When they attach one, call this tool again with the same arguments - the tool picks the new file up by itself and ignores the one it could not use. Then call this tool again with the same arguments on WHATEVER the user replies next - "done", "ok", "okay then add this", "then add this", "proceed with this", "proceed", "yes", "submit", or anything else. Only this tool can see the files in the chat, so never answer that a file is missing, unsupported or too large without calling it first.`
          }, attachmentBase);
        }

        if (rejectedAttachments.length > 0) {
          attachmentNotes.push(`${rejectedAttachments.map(r => `"${r.name}" was NOT attached because ${r.reason}`).join("; ")}. Read this out to the user: the file is still in the chat, and it is not part of this application.`);
        }
        const toUploadUsable = usable;

        /* A removal that names a file which was never on the application can
         * only cancel one the user just attached. When that would leave a
         * benefit type that REQUIRES an attachment with nothing at all, the
         * removal cannot be what they meant, and honouring it would refuse the
         * application over and over. The file is kept instead, and said so
         * plainly in the preview, which is shown before anything is submitted. */
        if (attachmentRules.mandatory
          && serverList.length - toRemoveFromServer.length + toUploadUsable.length === 0
          && suppressedByRemoval.length > 0) {
          inChat.forEach(f => {
            if (!suppressedByRemoval.some(n => sameName(n, f.name))) return;
            toUploadUsable.push(f);
            keptDespiteRemoval.push(f.name);
          });
          attachmentNotes.push(`${keptDespiteRemoval.map(n => `"${n}"`).join(", ")} ${keptDespiteRemoval.length === 1 ? "was" : "were"} named in removeAttachments but kept, because "${typeMatch.BetName}" requires an attachment and nothing else was attached. Tell the user so.`);
        }

        const finalCount = serverList.length - toRemoveFromServer.length + toUploadUsable.length;
        if (attachmentRules.maxCount && finalCount > attachmentRules.maxCount) {
          return Object.assign({
            needsInput: true,
            validationError: true,
            message: `"${typeMatch.BetName}" accepts at most ${attachmentRules.maxCount} attachment(s), but this would leave ${finalCount}. Nothing has been uploaded or submitted. Ask the user which file(s) to leave out and call again with removeAttachments listing them.`,
            attachments: serverList.map(a => a.BetAttachmentName).concat(toUploadUsable.map(f => f.name))
          }, attachmentBase);
        }

        const unknownRemovals = (Array.isArray(args.removeAttachments) ? args.removeAttachments : (args.removeAttachments ? [args.removeAttachments] : []))
          .filter(n => !serverList.some(a => sameName(a.BetAttachmentName, n)) && !inChat.some(f => sameName(f.name, n)));
        if (unknownRemovals.length > 0) {
          attachmentNotes.push(`No attachment named ${unknownRemovals.map(n => `"${n}"`).join(", ")} was found on this application, so nothing was removed for ${unknownRemovals.length === 1 ? "it" : "them"}. Only attachments that have not been submitted yet can be removed.`);
        }

        toolStage = "removing an attachment";
        for (const att of toRemoveFromServer) {
          const del = await postJson(
            `${base}/BenefitV9/api/ApplicationApi/DeleteAttachment`,
            { fileCode: att.BetAttachmentCode, empNumber: appEmpNumber, key: sessionKey },
            "DeleteAttachment"
          );
          if (del.error || (del.data && del.data.Status === false)) {
            const reason = `${del.data && del.data.Message ? `: ${del.data.Message}` : ""}`;
            /* A removal the user asked for is the point of the call, so it stops
             * here. A file being taken off to make way for a new one is not: the
             * upload still has to happen, and the leftover is reported instead of
             * losing the whole application to it. */
            if (toDelete.some(d => sameName(d.BetAttachmentName, att.BetAttachmentName))) {
              return Object.assign({
                needsInput: true,
                validationError: true,
                message: `Could not remove "${att.BetAttachmentName}"${reason}. Nothing has been submitted. Tell the user this exactly.`,
                detail: del.error || null
              }, attachmentBase);
            }
            attachmentNotes.push(`"${att.BetAttachmentName}" could not be taken off the application${reason}, so it is still attached alongside the new file. Tell the user.`);
          }
        }

        if (supersededByReplaceAll.length > 0) {
          attachmentNotes.push(`${supersededByReplaceAll.map(a => `"${a.BetAttachmentName}"`).join(", ")} ${supersededByReplaceAll.length === 1 ? "was" : "were"} taken off the application, replaced by what the user attached in the chat.`);
        }

        if (replaced.length > 0) {
          attachmentNotes.push(`${replaced.map(a => `"${a.BetAttachmentName}"`).join(", ")} ${replaced.length === 1 ? "was" : "were"} replaced with the newer file attached in the chat.`);
        }

        toolStage = "uploading an attachment";
        for (const file of toUploadUsable) {
          const resolved = await fileBlobOf(file);
          if (!resolved || !resolved.blob || !resolved.blob.size) {
            rejectedAttachments.push({
              name: file && file.name ? file.name : "(unnamed file)",
              reason: `the chat handed over no readable contents for it (it arrived as: ${describeEntry(file)})`
            });
            continue;
          }
          const form = new FormData();
          form.append("file_data", resolved.blob, resolved.name);
          // The screen's file-input widget id: size + "_" + URI-encoded name with
          // "%" turned into "_" (capture: 14107_pre_20configurations_20demo_20intro.docx).
          form.append("fileId", `${resolved.size}_${encodeURIComponent(resolved.name).replace(/%/g, "_")}`);
          form.append("initialPreview", "[]");
          form.append("initialPreviewConfig", "[]");
          form.append("initialPreviewThumbTags", "[]");
          form.append("benefitType", typeMatch.BetCode);
          form.append("key", sessionKey);
          form.append("empNumber", appEmpNumber);

          const up = await postForm(`${base}/BenefitV9//api/ApplicationApi/UploadAttachment/`, form, "UploadAttachment");
          if (up.error || !up.data || up.data.Status !== true) {
            const after = await listAttachments();
            return Object.assign({
              needsInput: true,
              validationError: true,
              message: `Could not attach "${file.name}"${up.data && up.data.Message ? `: ${up.data.Message}` : ""}. Nothing has been submitted. Tell the user this exactly, and ask them to attach a different file or to continue without it (call again with removeAttachments listing the file name).`,
              detail: up.error || null,
              attachments: after.list ? after.list.map(a => a.BetAttachmentName) : undefined
            }, attachmentBase);
          }
        }

        // Always read the list back after anything was uploaded or removed.
        if (toRemoveFromServer.length > 0 || toUploadUsable.length > 0) {
          const refreshed = await listAttachments();
          if (refreshed.error) return refreshed.error;
          serverList = refreshed.list;
        }
        stagedAttachments = serverList.map(a => a.BetAttachmentName).filter(Boolean);

      }
      return null;
    }


    /* ---------------------------------------------------------------------
     * Step 9: flatten. `ref` points back into `structure` itself, so every edit
     * lands in the same tree that is resent to GetDependentControlValues,
     * ValidateGridControl and SaveApplication.
     * ------------------------------------------------------------------- */
    function describeField(ctrl) {
      return {
        besId: ctrl.BesId,
        displayName: ctrl.BesDisplayName,
        mandatory: ctrl.BesIsMandatory === "mandatory",
        dataType: ctrl.BesDataType,
        ctrlType: ctrl.BesCtrlType,
        decimals: ctrl.BesDecimalCount || 0,
        ref: ctrl
      };
    }

    const fields = [];
    const infoControls = [];
    let totalControl = null;
    let gridControl = null;

    (structure.applicationRowVms || []).forEach(row => {
      (row.ApplicationStructureRowVms || []).forEach(ctrl => {
        if (ctrl.IsGridDef) {
          gridControl = ctrl;
          return;
        }
        // Total Request carries no BesDisplayName of its own; its label,
        // visibility and editability come from the structure's top-level
        // TotalRequestLabelName / TotalRequestVisible / TotalRequestEnable.
        if (ctrl.BesCtrlType === "VL") {  // "VL" = the screen's computed Total Request
          totalControl = ctrl;
          return;
        }
        if (ctrl.IsVisible === false) return;
        if (EDITABLE_CTRL_TYPES.includes(ctrl.BesCtrlType) && ctrl.BesDisplayName && ctrl.IsEnable !== false) {
          fields.push(describeField(ctrl));
        } else if (ctrl.BesCtrlType === "7") {  // "7" = Label
          infoControls.push(ctrl);
        }
      });
    });

    const totalLabel = structure.TotalRequestLabelName || "Total Request";
    function screenFlag(fromStructure, fromControl) {
      const structureSays = typeof fromStructure === "boolean" ? fromStructure : null;
      const controlSays = typeof fromControl === "boolean" ? fromControl : null;
      
      if (structureSays !== null && controlSays !== null) return structureSays && controlSays;
      if (structureSays !== null) return structureSays;
      if (controlSays !== null) return controlSays;
      return false;
    }

    const totalLabelControl = totalControl || {};
    const totalVisible = !!totalControl
      && screenFlag(structure.TotalRequestVisible, totalLabelControl.IsVisible);
    const totalEditable = totalVisible
      && screenFlag(structure.TotalRequestEnable, totalLabelControl.IsEnable);

    // Two controls sharing a display name would both take the same fieldValues
    // entry and silently double the computed total.
    const duplicateNames = fields
      .map(f => f.displayName.toLowerCase())
      .filter((n, i, all) => all.indexOf(n) !== i);
    if (duplicateNames.length > 0) {
      return `The "${typeMatch.BetName}" benefit type has more than one field called "${fields.find(f => f.displayName.toLowerCase() === duplicateNames[0]).displayName}", which this tool cannot tell apart. Please use the Benefit Management screen directly for this benefit type.`;
    }

    /* Dependent dropdowns. Confirmed by capture (Medical Claims): "Corporate
     * title" (ctrl 3, BesIsDiasblePostback 0) arrives with its option list, while
     * "Designation" (ctrl 3, BesIsDiasblePostback 1) arrives with RefObjectValue
     * null - its options are filled in only by the recalculation that follows
     * choosing a corporate title. The structure names no parent, so a dropdown
     * that starts empty is tied to the nearest dropdown before it that has
     * options and triggers a recalculation. Such a dropdown is asked for only
     * AFTER its parent is chosen, from the options PeoplesHR returns for that
     * choice - never typed freely by the user. */
    const dependentDropdowns = new Map();
    fields.forEach((f, i) => {
      if (f.ctrlType !== "3" || (f.ref.RefObjectValue || []).length > 0) return;  // "3" = Dropdown
      const earlier = fields.slice(0, i).reverse()
        .filter(p => p.ctrlType === "3" && (p.ref.RefObjectValue || []).length > 0);  // "3" = Dropdown
      const parent = earlier.find(p => String(p.ref.BesIsDiasblePostback) !== "1") || earlier[0] || null;
      dependentDropdowns.set(f.besId, parent);
    });

    function dependsOnText(field) {
      const parent = dependentDropdowns.get(field.besId);
      return parent ? `"${parent.displayName}"` : "the field it depends on";
    }

    // An optional dropdown the user chose to leave blank is passed as "".
    function leftBlank(field, values) {
      const key = keyFor(values, field.displayName);
      return !!key && !field.mandatory && String(values[key] == null ? "" : values[key]).trim() === "";
    }

    /* ---------------------------------------------------------------------
     * Step 10: recalculation. Confirmed by capture: straight after
     * GetApplicationStructure, Entitlement and Utilized Amount are "0.00"; only
     * once a changed field is posted to GetDependentControlValues does the
     * server answer with the real figures (15000.00 / 585.00 for Fuel
     * Reimbursement), and only then does the computed total update. They are
     * date-dependent: the same employee and type returned 435.00 utilized for
     * 17/09/2026 and 585.00 for 16/09/2026.
     *
     * The response is a FLAT array of {BesId, RefValue, RefObjectValue,
     * RefDisplayValue} merged back by BesId. The doubled slash in
     * "BenefitV9//api/..." is exactly what the UI sends.
     * ------------------------------------------------------------------- */
    const allControls = (structure.applicationRowVms || [])
      .flatMap(row => row.ApplicationStructureRowVms || []);

    // The value each control arrived with. The UI posts this as BaseValue on
    // every control (Entitlement goes out as RefValue "15000.00" with BaseValue
    // "0.00"; the date as RefValue "16/09/2026" with BaseValue null), so it is
    // the ORIGINAL structure value, not the previous call's.
    const baseValues = new Map(allControls.map(c => [c.BesId, c.RefValue]));

    let refreshFailed = null;

    function wireRow(ctrl, columnIndex) {
      const copy = Object.assign({}, ctrl);
      // The UI drops BesJavascript and never sends nulls for these four.
      delete copy.BesJavascript;
      copy.BaseValue = baseValues.has(ctrl.BesId) ? baseValues.get(ctrl.BesId) : null;
      copy.RefMultiValue = ctrl.RefMultiValue || [];
      copy.BesEmpElgParam = ctrl.BesEmpElgParam || [];
      copy.ApplicationGridDefVm = ctrl.ApplicationGridDefVm || {
        ApplicationGridRowVms: [],
        GridData: { RowItems: [] }
      };
      copy.divClass = ctrl.divClass || (columnIndex % 2 === 1 ? "bmLeftDiv" : "bmRightDiv");
      return copy;
    }

    function wiredRows() {
      return (structure.applicationRowVms || []).map(row => ({
        RowNum: row.RowNum,
        ApplicationStructureRowVms: (row.ApplicationStructureRowVms || [])
          .map(ctrl => wireRow(ctrl, ctrl.ColumnCount || 1))
      }));
    }

    function mergeFlatValues(list, controls) {
      list.forEach(updated => {
        const target = controls.find(c => c.BesId === updated.BesId);
        if (!target) return;
        target.RefValue = updated.RefValue;
        if (updated.RefDisplayValue !== null && updated.RefDisplayValue !== undefined) {
          target.RefDisplayValue = updated.RefDisplayValue;
        }
        // Never let a null wipe a populated option list - a dependent dropdown
        // (e.g. Designation, empty until Corporate title is chosen) is filled
        // only on the call that actually resolves it.
        if (updated.RefObjectValue) target.RefObjectValue = updated.RefObjectValue;
      });
    }

    async function refreshDependents(changedBesId, controlsToMerge) {
      const depResult = await postJson(
        `${base}/BenefitV9//api/ApplicationApi/GetDependentControlValues/`,
        {
          ApplicationRowVms: wiredRows(),
          CurrentBenefitStructId: changedBesId,
          CurrentEmployeeNumber: appEmpNumber,
          CurrentBenefitTypeCode: typeMatch.BetCode,
          VisibilityState: blob.VisibilityState || "1",
          ReadOnlyState: blob.ReadOnlyState || "0",
          StepId: blob.StepId || "0",
          AppId: blob.AppId,
          WfMainId: blob.WfMainId || null,
          CancelWfMainId: blob.CancelWfMainId || null,
          IsWorkflow: blob.IsWorkflow || "0",
          IsSummary: blob.IsSummary || "0",
          BetAppYear: blob.BetAppYear
        },
        "GetDependentControlValues"
      );

      // A failed recalculation is NOT survivable: entitlement would stay 0.00 and
      // the computed total would stay 0, which is exactly how application 161 was
      // filed with an applied amount of 0.00. Record it and block submission.
      if (depResult.error || !Array.isArray(depResult.data)) {
        refreshFailed = depResult.error || "GetDependentControlValues returned an unexpected response.";
        return false;
      }

      mergeFlatValues(depResult.data, controlsToMerge || allControls);
      return true;
    }

    /* ---------------------------------------------------------------------
     * The benefit type's own formulas. Some types do not compute anything on
     * the server: every control has BesIsDiasblePostback 1, GetDependentControlValues
     * answers with the values unchanged, and the screen instead asks
     * GetJavascripts for that type and runs what comes back in the browser.
     *
     * Confirmed by capture (Medical Reimbursement, betCode 310000): the response
     * is a block of "F_<BesId>(ctrl)" functions bound to the controls whose
     * BesIsJavascriptFlg is 1. They read the other controls by their BesId -
     * .value for an editable control, .innerHTML for a read-only one - and write
     * both the read-only figures (room charges = days x room rate) and the Total
     * Request control (applyAmount.value = amount). The UI then submits that
     * computed total: the captured SaveApplication sends VL310000 "5500" while
     * its RefDisplayValue is still "0.00". Without running them the total stays 0
     * and PeoplesHR records 0.00 as the applied amount.
     *
     * The formulas are the client's own configuration, so they are fetched per
     * benefit type and executed as written - nothing about any type, field or
     * arithmetic is hardcoded here. The controls are given to the script as
     * stand-ins backed by the live structure, so whatever the script writes lands
     * on the same tree that is previewed and submitted.
     * ------------------------------------------------------------------- */
    let typeScript;            // the script for this benefit type, fetched once
    let typeScriptCall = null; // invoker into that script, built once

    function scriptElementFor(ctrl) {
      return {
        id: ctrl.BesId,
        get value() { return ctrl.RefValue == null ? "" : String(ctrl.RefValue); },
        set value(v) { ctrl.RefValue = v == null ? "" : String(v); },
        // A read-only control shows its formatted text, which the formulas parse
        // with their own replace(",", "") - so give them the displayed string.
        get innerHTML() {
          const shown = ctrl.RefDisplayValue != null && ctrl.RefDisplayValue !== "" ? ctrl.RefDisplayValue : ctrl.RefValue;
          return shown == null ? "" : String(shown);
        },
        set innerHTML(v) {
          const text = v == null ? "" : String(v);
          ctrl.RefDisplayValue = text;
          ctrl.RefValue = text.replace(/,/g, "");
        },
        get innerText() { return this.innerHTML; },
        set innerText(v) { this.innerHTML = v; },
        get textContent() { return this.innerHTML; },
        set textContent(v) { this.innerHTML = v; },
        get checked() { return String(ctrl.RefValue) === "1"; },
        set checked(v) { ctrl.RefValue = v ? "1" : "0"; },
        style: {},
        classList: { add() { }, remove() { }, contains() { return false; }, toggle() { } },
        setAttribute() { }, removeAttribute() { }, getAttribute() { return null; },
        addEventListener() { }, removeEventListener() { },
        options: [], children: [], parentNode: null
      };
    }

    async function runTypeFormulas() {
      if (typeScript === undefined) {
        const result = await postJson(
          `${base}/BenefitV9//api/ApplicationApi/GetJavascripts/`,
          { betCode: typeMatch.BetCode },
          "GetJavascripts"
        );
        // A type with no formulas of its own is the normal case - the server
        // figures are then the real ones, so this must never block anything.
        typeScript = (!result.error && typeof result.data === "string") ? result.data : "";
      }
      if (!typeScript || !typeScript.trim()) return;

      const scriptControls = allControls.concat(workingRowControls);
      const elements = new Map();
      const elementById = id => {
        if (!elements.has(id)) {
          const ctrl = scriptControls.find(c => c.BesId === id);
          // An id the script expects but this structure does not have must not
          // throw - the rest of the formula still has to run.
          elements.set(id, ctrl ? scriptElementFor(ctrl) : scriptElementFor({ BesId: id }));
        }
        return elements.get(id);
      };

      if (typeScriptCall === null) {
        const documentShim = {
          getElementById: elementById,
          querySelector: () => null,
          querySelectorAll: () => [],
          getElementsByName: () => [],
          getElementsByClassName: () => [],
          createElement: () => scriptElementFor({ BesId: "" })
        };
        const jqueryShim = selector => {
          const el = elementById(String(selector).replace(/^[#.]/, ""));
          return {
            val(v) { if (v === undefined) return el.value; el.value = v; return this; },
            html(v) { if (v === undefined) return el.innerHTML; el.innerHTML = v; return this; },
            text(v) { if (v === undefined) return el.innerHTML; el.innerHTML = v; return this; },
            attr() { return undefined; }, on() { return this; }, trigger() { return this; },
            each() { return this; }, length: 1, 0: el
          };
        };
        try {
          typeScriptCall = new Function("document", "window", "$", "jQuery",
            typeScript + "\nreturn function (fnName, ctrlArg) {"
            + " var fn = null;"
            + " try { fn = eval(fnName); } catch (e) { fn = null; }"
            + " if (typeof fn !== 'function') return false;"
            + " fn(ctrlArg); return true;"
            + " };"
          )(documentShim, { document: documentShim }, jqueryShim, jqueryShim);
        } catch (e) {
          // A script this tool cannot run must not stop the application: the
          // total is put in front of the user either way, with its warning.
          typeScriptCall = false;
        }
      }
      if (!typeScriptCall) return;

      // The screen runs the function bound to a control when that control
      // changes, so run each one the same way, in structure order.
      scriptControls
        .filter(c => String(c.BesIsJavascriptFlg) === "1")
        .forEach(c => {
          try { typeScriptCall("F_" + c.BesId, elementById(c.BesId)); } catch (e) { /* leave the figures as they are */ }
        });
    }

    // Values we put in, so a recalculation that drops or rewrites one is caught
    // rather than silently submitted.
    const intended = new Map();

    function sameValue(ctrlType, a, b) {
      if (a === b) return true;
      if (a == null || b == null) return false;
      if (ctrlType === "2") {  // "2" = Numeric
        const na = numberOf(a), nb = numberOf(b);
        return na !== null && nb !== null && na === nb;
      }
      return String(a).trim() === String(b).trim();
    }

    async function assertIntactAfterRefresh() {
      for (const [besId, expected] of intended.entries()) {
        const ctrl = allControls.find(c => c.BesId === besId);
        if (!ctrl) continue;
        if (sameValue(ctrl.BesCtrlType, ctrl.RefValue, expected)) continue;

        // Re-assert once - then treat a second disagreement as the server
        // rejecting the value, and refuse rather than submit something else.
        ctrl.RefValue = expected;
        await refreshDependents(besId);
        if (refreshFailed) return `"${ctrl.BesDisplayName}" could not be set: ${refreshFailed}`;
        if (!sameValue(ctrl.BesCtrlType, ctrl.RefValue, expected)) {
          return `PeoplesHR would not accept "${expected}" for "${ctrl.BesDisplayName}" - it came back as "${ctrl.RefValue}". Check that value with the user before submitting.`;
        }
      }
      return null;
    }

    // For a grid benefit type the read-only figures (Entitlement, Utilized
    // Amount, Department) live on the grid's own row, not on the outer form -
    // the outer form holds only the computed total and the grid itself.
    function readOnlyControls() {
      if (gridControl && workingRowControls.length > 0) {
        return workingRowControls.filter(c => c.BesCtrlType === "7" && c.BesDisplayName);  // "7" = Label
      }
      return infoControls;
    }

    function infoSnapshot() {
      return readOnlyControls()
        .filter(c => c.BesDisplayName)
        .map(c => ({ displayName: c.BesDisplayName, value: c.RefDisplayValue || c.RefValue }));
    }

    function numericInfo(pattern) {
      const hit = readOnlyControls().find(c => c.BesDisplayName && pattern.test(c.BesDisplayName));
      if (!hit) return null;
      return numberOf(hit.RefValue != null ? hit.RefValue : hit.RefDisplayValue);
    }

    function entitlementSummary() {
      const entitlement = numericInfo(/entitle/i);
      const utilized = numericInfo(/utili[sz]/i);

      if (entitlement === null && utilized === null) {
        // Label-independent fallback: on a renamed or localized screen, the
        // read-only numeric controls whose value changed after the date
        // recalculation are the entitlement figures.
        const changed = readOnlyControls()
          .filter(c => c.BesDataType === "NUMERIC" && !sameValue("2", c.RefValue, baseValues.get(c.BesId)))
          .map(c => ({ displayName: c.BesDisplayName, value: numberOf(c.RefValue) }));
        return changed.length ? { unlabelled: changed } : null;
      }

      const summary = { entitlement, utilized };
      if (entitlement !== null && utilized !== null) summary.balance = +(entitlement - utilized).toFixed(2);
      return summary;
    }

    // Total Request carries a stale RefDisplayValue ("0.00" while RefValue is
    // "200" - straight from the capture), so RefValue is the only figure to trust.
    function totalRequested() {
      return totalControl ? numberOf(totalControl.RefValue) : null;
    }

    /* ---------------------------------------------------------------------
     * Grid benefit types (e.g. Telephone Bill Reimbursement). The outer form
     * holds only the computed total plus one IsGridDef control, whose
     * ApplicationGridDefVm carries the column definitions (GridStructureVms),
     * the working row (ApplicationGridRowVms) and the added rows
     * (GridData.RowItems).
     * ------------------------------------------------------------------- */
    const gridVm = gridControl ? (gridControl.ApplicationGridDefVm || {}) : null;
    const gridColumns = gridVm ? (gridVm.GridStructureVms || []) : [];
    const gridEditable = gridColumns
      .filter(c => EDITABLE_CTRL_TYPES.includes(c.BesCtrlType) && c.BesDisplayName && c.IsVisible !== false && c.IsEnable !== false)
      .map(describeField);

    const workingRowControls = gridVm
      ? (gridVm.ApplicationGridRowVms || []).flatMap(r => r.ApplicationStructureRowVms || [])
      : [];

    function workingControl(besId) {
      return workingRowControls.find(c => c.BesId === besId);
    }

    if (gridVm && !gridVm.GridData) gridVm.GridData = { RowItems: [] };
    if (gridVm && !Array.isArray(gridVm.GridData.RowItems)) gridVm.GridData.RowItems = [];

    // The grid's own controls carry values the outer form never sees, so they
    // need BaseValue tracking too (used to spot which read-only figures the
    // recalculation actually filled in).
    workingRowControls.forEach(c => {
      if (!baseValues.has(c.BesId)) baseValues.set(c.BesId, c.RefValue);
    });

    // Column order and shape confirmed from both the ValidateGridControl request
    // and the saved grid application (reference 170): every column, read-only
    // ones included, with Code and Value carrying the same string. CurrencyValue
    // is the UI's own display string - it really does send "undefined <value>"
    // when the column has no currency symbol, and that submitted successfully.
    function columnItemsFromWorkingRow() {
      return gridColumns.map(col => {
        const live = workingControl(col.BesId) || col;
        const value = live.RefValue;
        return {
          BesId: col.BesId,
          BesCtrlType: col.BesCtrlType,
          Code: value,
          Value: value,
          CurrencyValue: `${live.BesCurrencySymbol} ${value}`
        };
      });
    }

    async function validateGridRow(rowId) {
      const result = await postJson(
        `${base}/BenefitV9//api/ApplicationApi/ValidateGridControl/`,
        {
          GridData: gridVm.GridData,
          GridColumn: { RowId: rowId, IsEdit: false, ColumnItems: columnItemsFromWorkingRow() },
          GridDef: gridVm.GridDef,
          GridState: gridVm.GridState,
          StepId: blob.StepId || "0",
          AppId: blob.AppId,
          WfMainId: blob.WfMainId || null,
          ApplicationRowVms: wiredRows(),
          CurrentEmployeeNumber: appEmpNumber,
          CurrentBenefitTypeCode: typeMatch.BetCode,
          VisibilityState: blob.VisibilityState || "1",
          ReadOnlyState: blob.ReadOnlyState || "0",
          IsEditGrid: false,
          IsWorkflow: blob.IsWorkflow || "0",
          IsSummary: blob.IsSummary || "0",
          KeyValue: sessionKey,
          BetAppYear: blob.BetAppYear
        },
        "ValidateGridControl"
      );
      if (result.error) return { ok: false, message: result.error };

      // Confirmed envelope: {Message, Type, Title, Status, Object, ByteArray},
      // Status true with Object [] for a valid row.
      const body = result.data || {};
      if (body.Status !== true) {
        return { ok: false, message: body.Message || "PeoplesHR rejected this row." };
      }
      return { ok: true };
    }

    /* ---------------------------------------------------------------------
     * Value application, shared by the outer form and by each grid row.
     * ------------------------------------------------------------------- */
    function normalizeValue(field, value) {
      if (field.ctrlType === "3") {  // "3" = Dropdown
        const options = field.ref.RefObjectValue || [];
        if (options.length === 0) return { defer: true };
        const opt = options.find(o => String(o.Value).toLowerCase() === String(value).toLowerCase());
        if (!opt) {
          return { error: `"${value}" is not a valid option for "${field.displayName}". Valid options: ${options.map(o => o.Value).join(", ")}` };
        }
        // Dropdowns store the option's Id, never its label - confirmed by capture
        // (Corporate title sent as "000005", shown as "QA-Lead").
        return { value: opt.Id };
      }

      if (field.ctrlType === "5") {  // "5" = Date Picker
        if (!dateRegex.test(String(value))) {
          return { error: `"${field.displayName}" must be a date in ${dateFormat} format (e.g. ${todayFormatted()}) - got "${value}".` };
        }
        return { value: String(value) };
      }

      if (field.ctrlType === "4") {  // "4" = Checkbox: ticked posts "1", unticked "0"
        const text = String(value).toLowerCase().trim();
        if (["1", "true", "yes", "y"].includes(text)) return { value: "1" };
        if (["0", "false", "no", "n"].includes(text)) return { value: "0" };
        return { error: `"${field.displayName}" must be yes or no - got "${value}".` };
      }

      if (field.ctrlType === "2" || field.dataType === "NUMERIC") {  // "2" = Numeric
        // Numeric: "200 USD" passes a bare parseFloat, so write the parsed number
        // back rather than whatever was typed.
        const num = numberOf(value);
        if (num === null) {
          return { error: `"${field.displayName}" must be a number - got "${value}".` };
        }
        return { value: field.decimals > 0 ? num.toFixed(field.decimals) : String(num) };
      }
      
      // Whatever is left is free text - "1" Text Box or "8" Text Area - and is
      // sent exactly as the screen sends it ("Diagnosis" -> "test").
      return { value: value == null ? "" : String(value) };
    }

  function keyFor(values, name) {
      return Object.keys(values || {}).find(n => n.toLowerCase() === name.toLowerCase());
    }

    // Dates go first regardless of their position in the structure: entitlement
    // and every derived figure depend on the date, and posting an amount while
    // the date is still null computes it against a 0.00 entitlement.
    function orderedForApply(list) {
      return list.slice().sort((a, b) => (a.ctrlType === "5" ? 0 : 1) - (b.ctrlType === "5" ? 0 : 1));  // "5" = Date Picker
    }

    async function applyValues(fieldList, values, controlsToMerge, trackIntent) {
      const deferred = [];

      for (const field of orderedForApply(fieldList)) {
        const givenKey = keyFor(values, field.displayName);
        if (!givenKey) continue;
        if (field.ctrlType === "3" && leftBlank(field, values)) continue;  // "3" = Dropdown

        const outcome = normalizeValue(field, values[givenKey]);
        if (outcome.error) return { error: outcome.error };
        if (outcome.defer) { deferred.push(field); continue; }

        field.ref.RefValue = outcome.value;
        if (trackIntent) intended.set(field.besId, outcome.value);
        if (!await refreshDependents(field.besId, controlsToMerge)) {
          return { error: `Could not recalculate the application after setting "${field.displayName}": ${refreshFailed}` };
        }
      }

      // Second pass for dropdowns whose options only appeared once their parent
      // field was set - the structure does not guarantee parents come first.
      for (const field of deferred) {
        const givenKey = keyFor(values, field.displayName);
        const outcome = normalizeValue(field, values[givenKey]);
        if (outcome.error) return { error: outcome.error };
        if (outcome.defer) {
          return { error: `"${field.displayName}" has no options yet - its options depend on ${dependsOnText(field)}. Nothing has been submitted. Ask the user to choose ${dependsOnText(field)} first from the options this tool listed, then call again; the tool will then return the "${field.displayName}" options to choose from.` };
        }
        field.ref.RefValue = outcome.value;
        if (trackIntent) intended.set(field.besId, outcome.value);
        if (!await refreshDependents(field.besId, controlsToMerge)) {
          return { error: `Could not recalculate the application after setting "${field.displayName}": ${refreshFailed}` };
        }
      }

      return {};
    }

    function describeForDiscovery(field) {
      const options = field.ref.RefObjectValue || [];
      const isDate = field.ctrlType === "5";  // "5" = Date Picker
      return {
        displayName: field.displayName,
        // Whatever PeoplesHR marks mandatory is mandatory, dates included. A
        // date the screen calls not-mandatory is not asked for: the structure
        // arrives with the date already filled in (C200003 came back as
        // "29/09/2026"), and forcing every date control marked one type "5" as
        // required turned ten back-office dates on a single benefit type into
        // questions the user cannot answer.
        mandatory: field.mandatory,
        dataType: field.dataType,
        // "3" = Dropdown, "4" = Checkbox, "2" = Numeric
        inputType: isDate ? `date (${dateFormat})` : field.ctrlType === "3" ? "choice" : field.ctrlType === "4" ? "yes/no" : (field.ctrlType === "2" || field.dataType === "NUMERIC") ? "number" : "text",
        currentValue: field.ref.RefValue,
        options: options.length ? options.map(o => o.Value) : undefined,
        note: isDate
          ? `Already set to ${field.ref.RefValue || todayFormatted()}, and entitlement, utilized amount and the total are calculated for it. Do not ask the user for this date: report the figures as they stand. Send it only when they name a different date, and then send the one they gave.`
          : field.ctrlType === "3"  // "3" = Dropdown
            ? (options.length
              ? "Show these options as a list and let the user pick one. Never accept a value that is not in this list, and never let them type their own."
              : `Do not ask for this yet. Its options depend on ${dependsOnText(field)}: once the user has chosen that, call this tool again with it in fieldValues and the tool returns the "${field.displayName}" options to pick from.`)
            : undefined,
        dependsOn: dependentDropdowns.has(field.besId) && dependentDropdowns.get(field.besId)
          ? dependentDropdowns.get(field.besId).displayName
          : undefined
      };
    }


    function missingMandatory(fieldList, values) {
      return fieldList.filter(f => f.mandatory && !keyFor(values, f.displayName) && !dependentDropdowns.has(f.besId));
    }

    /* ---------------------------------------------------------------------
     * Step 11: discovery. Entitlement is 0.00 until a date is posted, so probe
     * with today purely to show live figures - nothing is saved by this, and the
     * probed date is reported so it is never mistaken for a choice the
     * user made.
     * ------------------------------------------------------------------- */
    // Before any early return: whatever is attached now gets staged now.
    const attachmentIssue = await syncAttachments();
    if (attachmentIssue) return attachmentIssue;

    const hasGrid = !!gridControl;
    const wantsApply = hasGrid ? !!args.rows : !!args.fieldValues;

    if (!wantsApply) {
      let probedDate = null;
      const probeField = (hasGrid ? gridEditable : fields).find(f => f.ctrlType === "5" && !f.ref.RefValue);  // "5" = Date Picker
      const probeTarget = hasGrid ? workingRowControls : allControls;

      if (probeField) {
        const probeControl = hasGrid ? (workingControl(probeField.besId) || probeField.ref) : probeField.ref;
        probedDate = todayFormatted();
        probeControl.RefValue = probedDate;
        await refreshDependents(probeField.besId, probeTarget);
        probeControl.RefValue = null;
        refreshFailed = null; // a probe failure must not block a later submit
      }

      const probedEntitlement = entitlementSummary();

      const discovery = {
        discovery: true,
        employee: employee.displayName,
        employeeNumber: employee.displayNumber,
        designation: (employeeDetails.Designation && employeeDetails.Designation.DsgName) || null,
        benefitType: typeMatch.BetName,
        entitlement: probedEntitlement,
        entitlementAsAt: probedDate,
        entitlementNote: probedDate
          ? `These figures are for ${probedDate} (today) ONLY. Entitlement and utilized amount differ on every application date - ${employee.displayName} may have ${probedEntitlement && probedEntitlement.entitlement} today and nothing at all on another date. Never repeat these figures for a different date: if the user names or changes the date, or asks what the entitlement is then, call this tool again with fieldValues containing just that application date and report what comes back.`
          : null,
        commentMandatory: betInfo.BetCommentMandatoryFlg === "1",
        showComment: betInfo.BetshowAppCommentBox === "1",
        confirmMessage: betInfo.IsConfirmNeed === "1" ? betInfo.ConfirmMessage : null,
        info: infoSnapshot(),
        attachment: attachmentRules.allowed
          ? Object.assign({}, attachmentRules, {
            filesInChat: stagedAttachments.slice(),
            note: `${attachmentRules.mandatory ? "At least one attachment is REQUIRED" : "Attachments are optional"} for this benefit type (${attachmentRulesText() || "no type or size limits set"}). Ask the user to attach the file(s) in the chat - the tool picks them up, validates them and stages them when it builds the preview. Do not ask for file contents or base64.`
          })
          : { allowed: false, note: "This benefit type does not accept attachments - do not ask for any." }
      };

      if (hasGrid) {
        discovery.message = `The benefit type is settled - do not re-confirm it. This benefit type is claimed as one or more rows${gridVm.GridDef && gridVm.GridDef.GridTitle ? ` under "${gridVm.GridDef.GridTitle}"` : ""}. Ask the user for the columns listed below for each row they want to claim, then call this tool again with the same benefitType plus a rows array, each row an object keyed by the column names shown. Ask for nothing that is not listed.`;
        discovery.rowsRequired = true;
        discovery.gridColumns = gridEditable.map(describeForDiscovery);
        discovery.readOnlyColumns = gridColumns
          .filter(c => c.BesCtrlType === "7" && c.BesDisplayName)  // "7" = Label
          .map(c => c.BesDisplayName);
      } else {
        discovery.message = `The benefit type is settled - do not re-confirm it. Ask the user ONLY for the fields listed below: every mandatory one, plus any optional ones they want to set. Ask for nothing that is not in this list. Then call this tool again with the same benefitType plus a fieldValues object keyed by each field's displayName exactly as shown.`;
        discovery.fields = fields.map(describeForDiscovery);
        if (fields.some(f => f.ctrlType === "3")) {  // "3" = Dropdown
          discovery.choiceNote = `Choice fields are pick-lists: show their options and let the user select one - never let them type a value of their own.${dependentDropdowns.size ? ` ${[...dependentDropdowns.keys()].map(id => { const f = fields.find(x => x.besId === id); return `"${f.displayName}" depends on ${dependsOnText(f)}`; }).join("; ")} - do not ask for ${dependentDropdowns.size === 1 ? "it" : "them"} yet; the tool lists ${dependentDropdowns.size === 1 ? "its" : "their"} options once the parent is chosen.` : ""}`;
        }
        if (totalVisible) {
          discovery.fields.push({
            displayName: totalLabel,
            mandatory: false,
            dataType: "NUMERIC",
            inputType: "number",
            currentValue: totalControl.RefValue,
            readOnly: !totalEditable,
            note: totalEditable
              ? `This is the amount Benefit History records against the application. PeoplesHR fills it in from the amount field(s) above, so leave it out unless the user asks for a particular Total Request. They CAN set it directly: pass the figure they ask for in fieldValues under "${totalLabel}" and leave the amount field(s) exactly as they gave them - never tell them it cannot be changed, and never ask them to change an amount to match it.`
              : "This is the amount Benefit History records against the application. PeoplesHR calculates it from the amount field(s) above; it cannot be set directly for this benefit type."
          });
        }
      }

      return discovery;
    }

    /* ---------------------------------------------------------------------
     * Step 12: apply the user's values.
     * ------------------------------------------------------------------- */
    let rowSummaries = [];

    if (!hasGrid) {
      const values = args.fieldValues || {};

      const unknown = Object.keys(values)
        .filter(name => name.toLowerCase() !== totalLabel.toLowerCase() && !fields.some(f => f.displayName.toLowerCase() === name.toLowerCase()));
      if (unknown.length > 0) {
        return `${unknown.map(n => `"${n}"`).join(", ")} ${unknown.length === 1 ? "is not a field" : "are not fields"} on the "${typeMatch.BetName}" benefit type. Valid fields: ${fields.map(f => f.displayName).concat(totalEditable ? [totalLabel] : []).join(", ")}`;
      }


      const missing = missingMandatory(fields, values);
      if (missing.length > 0) {
        return `Missing required field(s) for ${employee.displayName}'s "${typeMatch.BetName}" application: ${missing.map(f => f.displayName).join(", ")}. Call this tool again with these included in fieldValues.`;
      }

      const applied = await applyValues(fields, values, allControls, true);
      if (applied.error) return applied.error;

      const drift = await assertIntactAfterRefresh();
      if (drift) return drift;

      await runTypeFormulas();

      const pendingChoice = fields.find(f => dependentDropdowns.has(f.besId)
        && !keyFor(values, f.displayName)
        && (f.ref.RefObjectValue || []).length > 0);
      if (pendingChoice) {
        const parent = dependentDropdowns.get(pendingChoice.besId);
        const parentLabel = parent
          ? ((parent.ref.RefObjectValue || []).find(o => o.Id === parent.ref.RefValue) || {}).Value || parent.ref.RefValue
          : null;
        return {
          needsInput: true,
          field: pendingChoice.displayName,
          dependsOn: parent ? { field: parent.displayName, chosen: parentLabel } : undefined,
          options: pendingChoice.ref.RefObjectValue.map(o => o.Value),
          mandatory: pendingChoice.mandatory,
          message: `${parent ? `"${parent.displayName}" is set to "${parentLabel}". ` : ""}Show the user the "${pendingChoice.displayName}" options below exactly as listed - these are the only ones available${parent ? " for that choice" : ""} - and ask them to pick one. Do not let them type their own value. Nothing has been uploaded or submitted yet. Then call this tool again with the same arguments, adding "${pendingChoice.displayName}" to fieldValues.${pendingChoice.mandatory ? "" : ` It is optional: if the user does not want to set it, pass "${pendingChoice.displayName}": "" instead.`}`
        };
      }
    } else {
      const rows = Array.isArray(args.rows) ? args.rows : [args.rows];
      if (rows.length === 0) {
        return `At least one row is required for ${employee.displayName}'s "${typeMatch.BetName}" application.`;
      }

      for (let i = 0; i < rows.length; i++) {
        const rowValues = rows[i] || {};
        const rowLabel = rows.length > 1 ? ` (row ${i + 1})` : "";

        const unknown = Object.keys(rowValues)
          .filter(name => !gridEditable.some(f => f.displayName.toLowerCase() === name.toLowerCase()));
        if (unknown.length > 0) {
          return `${unknown.map(n => `"${n}"`).join(", ")} ${unknown.length === 1 ? "is not a column" : "are not columns"} on the "${typeMatch.BetName}" benefit type${rowLabel}. Valid columns: ${gridEditable.map(f => f.displayName).join(", ")}`;
        }

        // Work against the live row controls, which is what ColumnItems is built
        // from and what the recalculation fills in.
        const rowFields = gridEditable.map(f => Object.assign({}, f, { ref: workingControl(f.besId) || f.ref }));


        const missing = missingMandatory(rowFields, rowValues);
        if (missing.length > 0) {
          return `Missing required column(s)${rowLabel} for ${employee.displayName}'s "${typeMatch.BetName}" application: ${missing.map(f => f.displayName).join(", ")}.`;
        }

        const applied = await applyValues(rowFields, rowValues, workingRowControls, false);
        if (applied.error) return applied.error;

        const rowId = gridVm.GridData.RowItems.length + 1;
        const validation = await validateGridRow(rowId);
        if (!validation.ok) {
          return `PeoplesHR would not accept${rowLabel} this claim for ${employee.displayName}: ${validation.message}`;
        }

        gridVm.GridData.RowItems.push({
          RowId: rowId,
          IsEdit: false,
          ColumnItems: columnItemsFromWorkingRow()
        });

        rowSummaries.push(rowFields.reduce((acc, f) => {
          const live = workingControl(f.besId) || f.ref;
          acc[f.displayName] = f.ctrlType === "3"  // "3" = Dropdown
            ? ((live.RefObjectValue || []).find(o => o.Id === live.RefValue)?.Value ?? live.RefValue)
            : f.ctrlType === "4" ? (live.RefValue === "1" ? "Yes" : "No") : live.RefValue;  // "4" = Checkbox
          return acc;
        }, {}));
      }

      // The saved grid application (reference 170) carried Total Request "10" for
      // a single row whose amount was "10", so the total is the sum of the rows'
      // numeric columns. Ask the server for it first; fall back to summing the
      // rows ourselves if it has not caught up, since this figure is what Benefit
      // History records.
      const amountColumn = gridEditable.find(f => f.ctrlType === "2");  // "2" = Numeric
      if (amountColumn) await refreshDependents(amountColumn.besId, allControls);
      // This last refresh is an optimisation, not a dependency - the row values
      // are already validated and the fallback below covers the total - so a
      // failure here must not block a submission that is otherwise complete.
      refreshFailed = null;

      // Then pin the total to the sum of the rows' numeric column. Reference 170
      // recorded Total Request "10" for a single row whose amount was "10", so
      // the sum IS the figure Benefit History keeps - and pinning it also stops a
      // total left over from an earlier state of the form being submitted.
      if (totalControl) {
        const summed = gridVm.GridData.RowItems.reduce((sum, row) => {
          return sum + (row.ColumnItems || []).reduce((rowSum, ci) => {
            const col = gridColumns.find(c => c.BesId === ci.BesId);
            if (!col || col.BesCtrlType !== "2") return rowSum;  // "2" = Numeric
            return rowSum + (numberOf(ci.Value) || 0);
          }, 0);
        }, 0);
        totalControl.RefValue = String(summed);
      }
    }

    if (betInfo.BetCommentMandatoryFlg === "1" && !args.comment) {
      return `Error: a comment is required for ${employee.displayName}'s "${typeMatch.BetName}" application.`;
    }

    /* ---------------------------------------------------------------------
     * Step 13: Total Request override, set LAST and without a refresh after it -
     * every recalculation recomputes this control from the amount fields, so
     * setting it earlier would simply throw the user's override away. Not
     * directly confirmed by capture (no captured application overrode it), so if
     * an overridden total comes back recalculated, re-capture that one change.
     * ------------------------------------------------------------------- */
    const givenTotalKey = (!hasGrid && totalVisible) ? keyFor(args.fieldValues, totalLabel) : undefined;
    /* The figure can arrive either way: as its own argument, or as a key inside
     * fieldValues named after the label the screen uses. The screen itself
     * takes it without any request - confirmed by capture: the amount was left
     * at 100, the Total Request was typed down to 50, no call went out in
     * between, and SaveApplication carried Amount 100 with VL 50 (reference
     * 191). So whichever way it arrives, it is applied here, last, and nothing
     * recalculates after it. */
    const totalFromArgument = (!hasGrid && totalVisible
      && args.totalRequest !== undefined && args.totalRequest !== null
      && String(args.totalRequest).trim() !== "")
      ? args.totalRequest
      : undefined;
    const totalAsked = totalFromArgument !== undefined
      ? totalFromArgument
      : (givenTotalKey ? args.fieldValues[givenTotalKey] : undefined);
    let totalOverridden = false;

    if (totalAsked !== undefined && !totalEditable) {
      return `PeoplesHR locks "${totalLabel}" for the "${typeMatch.BetName}" benefit type, so it cannot be typed over on the Benefit Application screen either - it is always calculated from the amount field(s). Tell the user that, and ask whether to change the amount instead. Nothing has been submitted.`;
    }
    if (totalAsked !== undefined) {
      const totalValue = totalAsked;
      if (numberOf(totalValue) === null) {
        return `"${totalLabel}" must be a number - got "${totalValue}".`;
      }
      totalControl.RefValue = String(numberOf(totalValue));
      totalOverridden = true;
    }

    /* ---------------------------------------------------------------------
     * Step 14: final guards before anything can be submitted.
     * ------------------------------------------------------------------- */
    if (refreshFailed) {
      return {
        error: true,
        message: `PeoplesHR could not recalculate ${employee.displayName}'s "${typeMatch.BetName}" application, so entitlement and the applied amount cannot be trusted and nothing has been submitted. Please try again, or use the Benefit Management screen directly.`,
        detail: refreshFailed
      };
    }

    // A dropdown whose parent changed later in the run can be left holding an
    // option list - and an Id - that is no longer valid.
    const staleDropdown = (hasGrid ? gridEditable : fields).find(f => {
      if (f.ctrlType !== "3") return false;  // "3" = Dropdown
      const live = hasGrid ? (workingControl(f.besId) || f.ref) : f.ref;
      if (!live.RefValue) return false;
      return !(live.RefObjectValue || []).some(o => o.Id === live.RefValue);
    });
    if (staleDropdown) {
      return `The value chosen for "${staleDropdown.displayName}" is no longer one of its options - another field changed what it can be. Ask the user to choose it again.`;
    }

    const entitlement = entitlementSummary();
    let requested = totalRequested();

    // "2" = Numeric
    const amountFields = (hasGrid ? [] : fields).filter(f => f.ctrlType === "2" && (numberOf(f.ref.RefValue) || 0) > 0);
    const enteredAmount = amountFields.reduce((sum, f) => sum + (numberOf(f.ref.RefValue) || 0), 0);

    // The application date every figure below was calculated for - the same
    // employee and benefit type give different entitlement figures on different
    // dates, so the date is reported alongside them and must never be dropped.
    const dateField = (hasGrid ? gridEditable : fields).find(f => f.ctrlType === "5");  // "5" = Date Picker
    const entitlementAsAt = dateField
      ? ((hasGrid ? (workingControl(dateField.besId) || dateField.ref) : dateField.ref).RefValue || null)
      : null;

    /* Benefit History records the COMPUTED total, not the number typed into the
     * amount field: application 161 was filed with Amount in Bills 200 and an
     * applied amount of 0.00, while the same application through the UI (160)
     * recorded 200.00.
     *
     * A total of zero or below is not blocked - PeoplesHR's own screen allows an
     * application to be submitted when entitlement is exhausted (entitlement 0.00
     * on 02/09/2026 against 585.00 already utilized yields a Total Request of
     * -585.00, and the UI will still file it). Refusing here would block a flow
     * the product permits. Instead the recalculation is retried once, and the
     * figure is put in front of the user: the preview states it, and the
     * digest they confirm covers it, so the number can never be filed unseen. */
    let totalWarning = null;

    if (!totalOverridden && amountFields.length > 0 && totalControl && !(requested > 0)) {
      await refreshDependents(amountFields[amountFields.length - 1].besId, allControls);
      await runTypeFormulas();
      requested = totalRequested();

      /* Nothing filled it in, so the screen's own rule applies: Total Request
       * mirrors the amount. Confirmed by capture - posting "Amount in Bills"
       * 100 with CurrentBenefitStructId C200006 answers with VL200000
       * RefValue "100", that type's GetJavascripts is an empty F_C200006, and
       * SaveApplication then carries the same figure. Only done while the
       * control still holds the value the structure delivered, so a type that
       * does calculate its own total - including a negative one, when
       * entitlement is exhausted - keeps PeoplesHR's figure untouched. A total
       * the user set themselves has already set totalOverridden, so this whole
       * block is skipped and their figure stands. */
      const totalUntouched = String(totalControl.RefValue == null ? "" : totalControl.RefValue)
        === String(baseValues.get(totalControl.BesId) == null ? "" : baseValues.get(totalControl.BesId));
      if (totalUntouched && enteredAmount > 0 && totalEditable) {
        totalControl.RefValue = String(enteredAmount);
        requested = totalRequested();
      }

      if (!(requested > 0)) {
        const entitlementNote = entitlement && entitlement.entitlement !== null && entitlement.entitlement !== undefined
          ? ` ${employee.displayName}'s entitlement${entitlementAsAt ? ` for ${entitlementAsAt}` : ""} is ${entitlement.entitlement}${entitlement.utilized !== null && entitlement.utilized !== undefined ? `, with ${entitlement.utilized} already utilized` : ""}.`
          : "";
        totalWarning = `PeoplesHR calculates a Total Request of ${requested === null ? "nothing" : requested} for this application even though ${amountFields.map(f => `"${f.displayName}" is ${f.ref.RefValue}`).join(" and ")}.${entitlementNote} That calculated figure is what Benefit History will record as the applied amount, NOT the amount entered. Tell the user this plainly and get their agreement before submitting - a different date or amount may be what they intended.`;
      }
    }

    // Flagged whenever PeoplesHR's own total differs from what was typed in - the
    // user is confirming the computed figure, so a difference has to be
    // visible rather than buried.
    const amountMismatch = !totalOverridden && !hasGrid && enteredAmount > 0 && requested !== null && requested !== enteredAmount;

    const overBalance = entitlement && entitlement.balance !== undefined && entitlement.balance !== null
      && (entitlement.balance < 0 || (requested !== null && requested > entitlement.balance));

    const resolvedFields = hasGrid ? [] : fields.map(f => ({
      displayName: f.displayName,
      value: f.ctrlType === "3"  // "3" = Dropdown
        ? ((f.ref.RefObjectValue || []).find(o => o.Id === f.ref.RefValue)?.Value ?? f.ref.RefValue)
        : f.ctrlType === "4" ? (f.ref.RefValue === "1" ? "Yes" : "No") : f.ref.RefValue  // "4" = Checkbox
    }));

    /* ---------------------------------------------------------------------
     * Step 14b: attachments, staged on the server BEFORE the user confirms so
     * they can still be removed from the preview. Order:
     *   GetAttachments -> DeleteAttachment (names in removeAttachments)
     *   -> UploadAttachment (new chat files) -> GetAttachments.
     * The server keeps staged files against the application-session key, and
     * SaveApplication carries no attachment fields - it links them through
     * KeyValue. Type, size and count are checked locally against
     * currentBenefitType before anything changes on the server. This also runs
     * on the confirm call: a file added or removed after the preview changes the
     * digest and forces a fresh preview instead of being submitted unseen.
     * ------------------------------------------------------------------- */
    const lateAttachmentIssue = await syncAttachments();
    if (lateAttachmentIssue) return lateAttachmentIssue;

    if (attachmentRules.allowed) {
      if (attachmentRules.mandatory && stagedAttachments.length === 0) {
        return Object.assign({
          needsInput: true,
          missingFields: ["Attachment"],
          suppressedByRemoval: suppressedByRemoval.length ? suppressedByRemoval.slice() : undefined,
          rejectedAttachments: rejectedAttachments.length ? rejectedAttachments.slice() : undefined,
          diagnostics: { toolSupportsAttachments: true, chatHelperPresent: chatFileSource.helperPresent, filesSeenInChat: chatFileSource.filesSeen, readError: chatFileSource.readError },
          message: rejectedAttachments.length
            ? `${rejectedAttachments.map(r => `"${r.name}" could not be attached because ${r.reason}`).join("; ")}. "${typeMatch.BetName}" requires an attachment, so nothing has been submitted. Tell the user this exactly and ask them to attach the document again in the chat.`
            : suppressedByRemoval.length
              ? `${suppressedByRemoval.map(n => `"${n}"`).join(", ")} ${suppressedByRemoval.length === 1 ? "was" : "were"} attached in the chat but left out because removeAttachments named ${suppressedByRemoval.length === 1 ? "it" : "them"}, and "${typeMatch.BetName}" requires at least one attachment (${attachmentRulesText() || "any file type"}), so nothing has been submitted. ${suppressedByRemoval.length === 1 ? "That file was never on the application, so there was nothing to remove" : "Those files were never on the application, so there was nothing to remove"}. If the user wants to submit with ${suppressedByRemoval.length === 1 ? "it" : "them"}, call this tool again with the same arguments but WITHOUT ${suppressedByRemoval.length === 1 ? "that name" : "those names"} in removeAttachments. Only name a file there when it is already attached to the application and the user wants it taken off.`
              : `"${typeMatch.BetName}" requires at least one attachment (${attachmentRulesText() || "any file type"}). Nothing has been submitted. Ask the user ONCE to attach the document in the chat, then call this tool again with the same arguments. This tool CAN upload attachments - it just has none yet. Then call this tool again with the same arguments on WHATEVER the user replies next - "done", "ok", "okay then add this", "then add this", "proceed with this", "proceed", "yes", "submit", or anything else. Only this tool can see the files in the chat, so never answer that a file is missing, unsupported or too large without calling it first.`
        }, attachmentBase);
      }
    }

    function attachmentPreviewNote() {
      if (!attachmentRules.allowed) return null;
      const staged = stagedAttachments.length
        ? `Attached: ${stagedAttachments.map(n => `"${n}"`).join(", ")}. Show these to the user with the rest of the preview - before confirming they can still remove any of them (call again with removeAttachments listing the file name, and keep passing it on later calls)${attachmentRules.maxCount && stagedAttachments.length >= attachmentRules.maxCount ? "" : " or attach more in the chat"}.`
        : `No attachment added (optional; ${attachmentRulesText() || "any file type"}). The user can attach one in the chat before confirming.`;
      return [staged, `Pass attachmentSessionKey:"${sessionKey}" on every later call for this application, including the confirmation; leave it out if the benefit type changes.`]
        .concat(attachmentNotes).join(" ");
    }

    /* ---------------------------------------------------------------------
     * Step 15: preview, bound to the submit by a digest. The preview call and
     * the confirm call are independent runs - entitlement can change between
     * them (another application filed, a different day) - so the user must
     * be confirming the figures they were actually shown.
     * ------------------------------------------------------------------- */
    const previewDigest = digestOf({
      employee: employee.displayNumber,
      betCode: typeMatch.BetCode,
      fields: resolvedFields,
      rows: rowSummaries,
      total: requested,
      entitlement,
      comment: args.comment || null,
      attachments: stagedAttachments.map(n => n.toLowerCase()).sort()
    });

    function previewPayload(extra) {
      return Object.assign({
        preview: true,
        employee: employee.displayName,
        employeeNumber: employee.displayNumber,
        benefitType: typeMatch.BetName,
        entitlement,
        // These figures belong to this date only - the same employee and type
        // give different entitlement on a different date.
        entitlementAsAt,
        [totalLabel]: requested,
        totalWasOverridden: totalOverridden,
        /* Whether the figure can be typed over, stated on the response the
        * agent is actually holding when the user asks to change it. The
        * field list says so too, but that was several turns ago, and without
        * it here the request gets refused as "they are directly linked". */
        totalRequestEditable: totalEditable,
        totalRequestNote: totalEditable
          ? `The screen reports "${totalLabel}" as editable (TotalRequestEnable), and PeoplesHR records whatever it holds when the application is submitted, so the user can set it to any figure they ask for - it does NOT have to match the amount field(s). If they ask for a different ${totalLabel} ("change the total request to 150"), call this tool again with the same arguments plus totalRequest:<the figure> (or "${totalLabel}" in fieldValues), leaving the amount field(s) exactly as they are. Never tell them the two are linked or that it cannot be changed.`
          : `PeoplesHR locks "${totalLabel}" for this benefit type, so it cannot be typed over on the Benefit Application screen either.`,
        // The figure was typed over rather than calculated, so say so plainly:
        // the amount field(s) still hold what was entered, and Benefit History
        // records this total.
        totalOverrideNote: totalOverridden
          ? `"${totalLabel}" was set to ${requested} as asked, and the amount field(s) keep the values that were entered. Benefit History will record ${requested}. Show both figures to the user before they confirm.`
          : null,
        amountEntered: enteredAmount || null,
        // Both of these must be read out to the user before they confirm -
        // the figure PeoplesHR records is the calculated one, not what was typed.
        totalWarning,
        amountWarning: amountMismatch && !totalWarning
          ? `PeoplesHR will record ${requested}, not the ${enteredAmount} that was entered - it applies its own rules to work out the Total Request. Show the user both figures before they confirm.`
          : null,
        balanceWarning: overBalance
          ? `${employee.displayName} has ${entitlement.balance} left${entitlementAsAt ? ` as at ${entitlementAsAt}` : ""} (entitlement ${entitlement.entitlement}, utilized ${entitlement.utilized}), and this application requests ${requested}. Point this out to the user before they confirm - PeoplesHR applies its own rules on submission.`
          : null,
        confirmMessage: betInfo.IsConfirmNeed === "1" ? betInfo.ConfirmMessage : null,
        info: infoSnapshot(),
        fields: hasGrid ? undefined : resolvedFields,
        rows: hasGrid ? rowSummaries : undefined,
        comment: args.comment || null,
        attachments: attachmentRules.allowed ? stagedAttachments : undefined,
        // Files that were received and checked but could not be attached.
        // Read every one of these out: the user attached them and would
        // otherwise believe they are on the application.
        rejectedAttachments: rejectedAttachments.length ? rejectedAttachments : undefined,
        keptDespiteRemoval: keptDespiteRemoval.length ? keptDespiteRemoval.slice() : undefined,
        attachmentWarning: keptDespiteRemoval.length
          ? `${keptDespiteRemoval.map(n => `"${n}"`).join(", ")} ${keptDespiteRemoval.length === 1 ? "was" : "were"} listed for removal, but "${typeMatch.BetName}" requires an attachment and nothing else was attached, so ${keptDespiteRemoval.length === 1 ? "it is" : "they are"} on this application. Tell the user before they confirm: if ${keptDespiteRemoval.length === 1 ? "that file is" : "those files are"} wrong, ask them to attach the right one in the chat and call again.`
          : rejectedAttachments.length
            ? `${rejectedAttachments.map(r => `"${r.name}" was not attached because ${r.reason}`).join("; ")}. Tell the user this in full before they confirm. ${stagedAttachments.length ? `The application carries ${stagedAttachments.map(n => `"${n}"`).join(", ")} only.` : ""} They can attach a replacement in the chat and this tool will pick it up on the next call.`
            : null,
        attachmentRequired: attachmentRules.mandatory,
        attachmentRules: attachmentRules.allowed ? attachmentRules : undefined,
        canStillAddAttachment: attachmentRules.allowed && !(attachmentRules.maxCount && stagedAttachments.length >= attachmentRules.maxCount),
        attachmentSessionKey: attachmentRules.allowed ? sessionKey : undefined,
        attachmentNote: attachmentPreviewNote(),
        previewDigest
      }, extra || {});
    }

    if (!args.confirmed) {
      return previewPayload({
        message: `Review this application with the user, making clear this is their own benefit application${totalWarning ? ", and read them the totalWarning below in full - PeoplesHR will record that calculated figure, not the amount entered" : ""}. ${attachmentRules.allowed ? " Also read them the attachmentNote below." : ""} ${totalEditable ? ` If the user asks for a different ${totalLabel} ("change the total request to 150"), that IS allowed: call this tool again with the same arguments plus totalRequest:<the figure>, leaving the amount field(s) exactly as they are - never answer that it is calculated from the amount or that the two are linked.` : ""} Once they agree, call this tool again with the same arguments${attachmentRules.allowed ? ` (including attachmentSessionKey:"${sessionKey}")` : ""} plus confirmed:true and previewDigest:"${previewDigest}" copied exactly from this response.`
      });
    }

    if (!args.previewDigest) {
      return previewPayload({
        message: `Nothing has been submitted: a confirmation must carry the previewDigest from the preview the user actually saw. Show them these figures, then call again with confirmed:true and previewDigest:"${previewDigest}".`
      });
    }

    if (args.previewDigest !== previewDigest) {
      return previewPayload({
        changed: true,
        message: `The application has changed since the user saw it - most likely ${employee.displayName}'s entitlement or utilized amount moved, or an attachment was added or removed. Nothing has been submitted. Show them these updated figures and, if they still agree, call again with confirmed:true and previewDigest:"${previewDigest}".`
      });
    }

    /* ---------------------------------------------------------------------
     * Step 16: submit. Exactly the 7 keys the capture sends - for grid types too
     * (reference 170), where the rows ride inside the grid control's
     * ApplicationGridDefVm.GridData.RowItems within ApplicationRowVms.
     * ------------------------------------------------------------------- */
    toolStage = "submitting the application";
    const saveResult = await postJson(
      `${base}/BenefitV9//api/ApplicationApi/SaveApplication/`,
      {
        /* The same wired shape the screen posts, not the bare structure rows.
         * Confirmed by capture: every control in SaveApplication carries its
         * BaseValue - the value it arrived with - beside the RefValue it now
         * holds (VL200000 went out as RefValue "50" with BaseValue "0", the
         * amount as "100" with BaseValue "0"). Sending the rows unwired left
         * BaseValue off every control, so the server saw no before-and-after for
         * the figure that was typed over. */
        ApplicationRowVms: wiredRows(),
        CurrentEmployeeNumber: appEmpNumber,
        CurrentBenefitTypeCode: typeMatch.BetCode,
        BetCommentMandatoryFlg: betInfo.BetCommentMandatoryFlg || "0",
        ApplicantComment: args.comment || null,
        VisibilityState: blob.VisibilityState || "1",
        KeyValue: sessionKey
      },
      "SaveApplication"
    );
    if (saveResult.error) return saveResult.error;

    const saved = saveResult.data || {};

    /* The server re-checks the mandatory attachment itself - confirmed by
     * capture: Status false, Type "TypeWarning", Message "Please add an
     * Attachment." - e.g. when a staged file was removed on the screen between
     * the preview and this confirm. Nothing was filed, so ask for the file
     * instead of reporting a generic failure. */
    if (saved.Status !== true && attachmentRules.allowed && /attach/i.test(saved.Message || "")) {
      return Object.assign({
        needsInput: true,
        submitted: false,
        missingFields: ["Attachment"],
        message: `PeoplesHR did not submit the application: "${saved.Message}" Nothing has been submitted. Ask the user to attach the document in the chat (${attachmentRulesText() || "any file type"}), then call this tool again with the same arguments.`
      }, attachmentBase);
    }

    /* After a successful submit the screen clears the staged files for this
     * session key - confirmed by capture: DeleteAttachments {empNumber, key,
     * appId} straight after SaveApplication, answering an empty body. The
     * attachments are already saved with the application by then, so this is
     * housekeeping only: its outcome never changes the result reported. */
    if (saved.Status === true && attachmentRules.allowed) {
      try {
        await fetch(`${base}/BenefitV9/api/ApplicationApi/DeleteAttachments`, {
          method: "POST",
          headers: benefitHeaders,
          body: JSON.stringify({ empNumber: appEmpNumber, key: sessionKey, appId: blob.AppId }),
          redirect: "follow"
        });
      } catch (e) {
        // housekeeping only - the application is already submitted
      }
    }

    return {
      submitted: !!saved.Status,
      message: saved.Message
        ? saved.Message
        : `Your application was not confirmed as submitted - please check the Benefit Management screen.`,
      employee: employee.displayName,
      employeeNumber: employee.displayNumber,
      benefitType: typeMatch.BetName,
      entitlement,
      entitlementAsAt,
      [totalLabel]: requested,
      amountEntered: enteredAmount || null,
      totalWarning,
      fields: hasGrid ? undefined : resolvedFields,
      rows: hasGrid ? rowSummaries : undefined,
      attachments: attachmentRules.allowed ? stagedAttachments : undefined,
      rejectedAttachments: rejectedAttachments.length ? rejectedAttachments : undefined
    };
  } catch (toolError) {
    return {
      error: true,
      failedAt: toolStage,
      message: `This application could not be completed - the tool failed while ${toolStage}. Nothing has been submitted. Tell the user that plainly and show the detail below; it names the step that failed.`,
      detail: String((toolError && (toolError.stack || toolError.message)) || toolError),
      arguments: { benefitType: args && args.benefitType, replaceAttachments: args && args.replaceAttachments, removeAttachments: args && args.removeAttachments, attachmentSessionKey: args && args.attachmentSessionKey, confirmed: args && args.confirmed }
    };
  }
})