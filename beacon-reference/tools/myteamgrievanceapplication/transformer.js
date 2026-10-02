(async function (data, args, reqOptions) {
  try {
    const base = `${location.origin}/${reqOptions.sl}`;
    const MAX_DESCRIPTION_LENGTH = 200;

    /* ---------------------------------------------------------------------
     * Access: the "Grievance - Team" screen (type=1) must be on the user's menu.
     * ------------------------------------------------------------------- */
    if (
      !BeaconBar.user?.metaData?.menus?.some(menu =>
        menu.includes("GrievanceV9/RecordGrievance/Index?type=1")
      )
    ) {
      return { error: true, message: "You do not have access to apply for grievance. Please contact HR Admin." };
    }

    /* ---------------------------------------------------------------------
     * Description limit: the Grievance screen caps Description at 200 characters (spaces
     * included) with a maxlength on the textarea, so the browser can never send more. Beacon
     * bypasses that control and posts straight to RecordGrievance/Submit, which only answers
     * an oversized description with a generic failure - so the same rule is enforced here,
     * before any network call. The text is never silently truncated.
     * ------------------------------------------------------------------- */
    if (args.description !== undefined && args.description !== null && typeof args.description !== "string") {
      return { error: "description must be text." };
    }

    if (typeof args.description === "string" && args.description.length > MAX_DESCRIPTION_LENGTH) {
      return {
        error: `The grievance description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters, including spaces. Please shorten the description and try again.`,
        maxLength: MAX_DESCRIPTION_LENGTH,
        currentLength: args.description.length
      };
    }

    /* ---------------------------------------------------------------------
     * Small helpers
     * ------------------------------------------------------------------- */
    const jsonHeaders = new Headers();
    jsonHeaders.append("accept", "application/json, text/plain, */*");
    jsonHeaders.append("content-type", "application/json;charset=UTF-8");

    // Network failures and non-JSON bodies (HTML error pages, "Data is not intended to the
    // requesting audience", empty 500s) come back as { error } instead of throwing.
    async function readJson(res, label) {
      const text = await res.text();

      try {
        return { data: JSON.parse(text) };
      } catch (e) {
        return { error: `${label} did not return usable data (HTTP ${res.status}). ${text.slice(0, 200) || "(empty response)"}` };
      }
    }

    async function getJson(url, label) {
      try {
        const res = await fetch(url, { method: "GET", headers: { "accept": "application/json, text/plain, */*" }, redirect: "follow" });
        return await readJson(res, label);
      } catch (e) {
        return { error: `${label} could not be reached: ${(e && e.message) || e}` };
      }
    }

    async function postJson(url, body, label) {
      try {
        const res = await fetch(url, { method: "POST", headers: jsonHeaders, body: JSON.stringify(body), redirect: "follow" });
        return await readJson(res, label);
      } catch (e) {
        return { error: `${label} could not be reached: ${(e && e.message) || e}` };
      }
    }

    function norm(s) {
      return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    }

    /* ---------------------------------------------------------------------
     * Step 1: bootstrap the Team grievance page - new recHeadCode plus the page's own
     * subordinate-search widget.
     * ------------------------------------------------------------------- */
    const digestKey = await BeaconBar.executeFunction("getDigest")("type=1");
    const indexUrl = `${base}/GrievanceV9/RecordGrievance/Index?type=1&digest=${digestKey.digest}`;

    let indexHtml = "";

    try {
      const indexRes = await fetch(indexUrl, {
        method: "GET",
        headers: { "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
        redirect: "follow"
      });
      indexHtml = await indexRes.text();
    } catch (e) {
      return "Could not load the Team Grievance page - please try again.";
    }

    const doc = new DOMParser().parseFromString(indexHtml, "text/html");
    const recHeadCode = doc.querySelector("#hdnRecHeadCode")?.value;
    const pageSelectedEmpNumber = doc.querySelector("#hdnSelectedEmpNumber")?.value || "";

    if (!recHeadCode) {
      return "Could not load the Team Grievance page - please try again.";
    }

    // The page bakes the already-signed "search my subordinates" URL into its markup; if
    // that is not found it is rebuilt from the page's own empNumber/searchToken, with the
    // callBack and query parameters captured live from this screen.
    function buildSubordinateSearchUrl(html) {
      const embedded = /["']([^"'<>]*searchQueryMode=subordinatesonly[^"'<>]*)["']/.exec(html);

      if (embedded) {
        return { raw: embedded[1].replace(/&amp;/g, "&"), source: "embedded" };
      }

      const empNumberMatch = /empNumber=([^&"'\s<>]+)/.exec(html);
      const searchTokenMatch = /searchToken=([^&"'\s<>]+)/.exec(html);

      if (!empNumberMatch || !searchTokenMatch) {
        return { raw: null, source: "none" };
      }

      return { rebuilt: { empNumber: empNumberMatch[1], searchToken: searchTokenMatch[1] }, source: "rebuilt" };
    }

    const searchSource = buildSubordinateSearchUrl(indexHtml);
    let searchUrl = null;

    if (searchSource.raw) {
      searchUrl = new URL(searchSource.raw, indexUrl).href;
    } else if (searchSource.rebuilt) {
      const params = `empNumber=${String(searchSource.rebuilt.empNumber).replace(/=/g, "%3D")}&callBack=MQAzADcALAAgADIA&searchMode=0&searchQueryMode=subordinatesonly&searchQueryState=activeonly&isDivLoading=1&isMultiple=0&searchToken=${searchSource.rebuilt.searchToken}`;
      const searchDigest = await BeaconBar.executeFunction("getDigest")(params);

      searchUrl = `${base}/CommonComponents/Search/Search?${params}&digest=${searchDigest.digest}`;
    }

    function searchWidgetProblem(extra) {
      return {
        error: "Could not load your team list from the Team Grievance page - please try again, or contact your HR administrator if it keeps happening.",
        diagnostics: Object.assign({
          searchUrlSource: searchSource.source,
          pageHasSubordinatesOnly: indexHtml.includes("searchQueryMode=subordinatesonly"),
          pageHasSearchToken: indexHtml.includes("searchToken=")
        }, extra || {})
      };
    }

    if (!searchUrl) {
      return searchWidgetProblem();
    }

    let searchHtml = "";

    try {
      const searchRes = await fetch(`${searchUrl}${searchUrl.includes("?") ? "&" : "?"}_=${Date.now()}`, {
        method: "GET",
        headers: { "accept": "text/html, */*; q=0.01", "x-requested-with": "XMLHttpRequest" },
        redirect: "follow"
      });
      searchHtml = await searchRes.text();
    } catch (e) {
      return searchWidgetProblem({ fetchError: String((e && e.message) || e) });
    }

    // The widget issues its own EmpNumber/KeyValue pair - not the page's.
    const smartMatch = /window\.smartSearchModelObj\s*=\s*'([\s\S]*?)';/.exec(searchHtml);
    let smartModel = null;

    if (smartMatch) {
      try { smartModel = JSON.parse(smartMatch[1]); } catch (e) { smartModel = null; }
    }

    if (!smartModel || !smartModel.EmpNumber || !smartModel.KeyValue) {
      return searchWidgetProblem({ searchHtmlLength: searchHtml.length });
    }

    /* ---------------------------------------------------------------------
     * Step 2: the supervisor's subordinates. Everything below only ever resolves against
     * this list, so a non-subordinate can never be selected.
     * ------------------------------------------------------------------- */
    const subsRes = await postJson(`${base}/CommonComponents/Search/GetSubordinatesByEmpNumber/`, {
      empNumber: smartModel.EmpNumber,
      key: smartModel.KeyValue
    }, "GetSubordinatesByEmpNumber");

    if (subsRes.error) {
      return subsRes.error;
    }

    const team = (Array.isArray(subsRes.data) ? subsRes.data : [])
      .map(s => {
        const name = String(s.EmpDisplayName || "").replace(/\s+/g, " ").trim();
        return { empNumber: s.EmpNumber, name, norm: norm(name), tokens: norm(name).split(" ").filter(Boolean) };
      })
      .filter(s => s.empNumber && s.name);

    if (!team.length) {
      return "You have no subordinates to submit a grievance for. To submit a grievance for yourself, use submitMyGrievanceApplication instead.";
    }

    const teamNames = team.map(t => t.name);

    /* ---------------------------------------------------------------------
     * Step 3: identify the team member by NAME only (never an employee number).
     * ------------------------------------------------------------------- */
    const wantedEmployee = typeof args.employeeName === "string" ? args.employeeName.trim() : "";

    if (!wantedEmployee) {
      return {
        message: "Which team member is this grievance for? Ask the user to pick one of their team members by name (never ask for an employee number).",
        teamMembers: teamNames
      };
    }

    function findMembers(wantedRaw) {
      const wanted = norm(wantedRaw);

      if (!wanted) {
        return [];
      }

      const wantedTokens = wanted.split(" ");

      const exact = team.filter(t => t.norm === wanted);

      if (exact.length) {
        return exact;
      }

      // Whole-word matches first, so "Liam" never silently resolves to "William".
      const wholeWord = team.filter(t => wantedTokens.every(w => t.tokens.includes(w)));

      if (wholeWord.length) {
        return wholeWord;
      }

      return team.filter(t => wantedTokens.every(w => t.tokens.some(tt => tt.startsWith(w))));
    }

    async function designationOf(member) {
      const res = await getJson(`${base}/GrievanceV9/Common/GetEmployeeDetails?empNumber=${encodeURIComponent(member.empNumber)}`, "GetEmployeeDetails");
      return res.data && res.data.empDesignation ? String(res.data.empDesignation).trim() : "";
    }

    let matches = findMembers(wantedEmployee);

    if (!matches.length) {
      return {
        message: `"${wantedEmployee}" is not one of your team members, so a grievance cannot be submitted for them. Ask the user to choose from their team (by name only, never an employee number).`,
        teamMembers: teamNames
      };
    }

    // Two team members can share the exact same name; designation is the only thing that
    // can tell them apart without asking for an employee number.
    const wantedDesignation = typeof args.employeeDesignation === "string" ? args.employeeDesignation.trim().toLowerCase() : "";
    const labelCounts = {};

    matches.forEach(m => { labelCounts[m.norm] = (labelCounts[m.norm] || 0) + 1; });

    const hasSameNames = Object.values(labelCounts).some(n => n > 1);

    if (matches.length > 1 && (hasSameNames || wantedDesignation)) {
      for (const m of matches) {
        m.designation = await designationOf(m);
      }

      if (wantedDesignation) {
        const narrowed = matches.filter(m => m.designation.toLowerCase() === wantedDesignation)
          .concat(matches.filter(m => m.designation.toLowerCase() !== wantedDesignation && m.designation.toLowerCase().includes(wantedDesignation)));

        if (narrowed.length) {
          matches = narrowed;
        }
      }
    }

    if (matches.length > 1) {
      const labelled = matches.map(m => (m.designation ? `${m.name} (${m.designation})` : m.name));
      const stillIdentical = new Set(labelled).size < labelled.length;

      if (stillIdentical) {
        return {
          error: `More than one of your team members is called "${matches[0].name}" and they cannot be told apart here. This grievance cannot be submitted from chat for them - please submit it from the Grievance screen instead.`,
          teamMembers: labelled
        };
      }

      return {
        message: `More than one team member matches "${wantedEmployee}": ${labelled.join(", ")}. Ask the user which one they mean (by name${matches.some(m => m.designation) ? " or designation" : ""} - never an employee number), then call this tool again with that name${matches.some(m => m.designation) ? " (and employeeDesignation if the names are identical)" : ""}.`,
        matchingTeamMembers: labelled
      };
    }

    const employee = matches[0];
    const employeeName = employee.name;

    function context(extra) {
      return Object.assign({ employee: employeeName }, extra);
    }

    /* ---------------------------------------------------------------------
     * Step 4: grounds, then template + channel members (all scoped to the chosen employee).
     * ------------------------------------------------------------------- */
    const sourcesRes = await getJson(`${base}/GrievanceV9/RecordGrievance/GetGrievanceSources`, "GetGrievanceSources");

    if (sourcesRes.error) {
      return context({ error: "Could not load the grievance grounds - please try again." });
    }

    const sources = sourcesRes.data;

    const mainGrounds = (Array.isArray(sources) ? sources : []).map(g => ({
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
      return context({ message: "No grievance grounds are currently available. Please contact your HR administrator." });
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
      const wantedGround = wantedGroundRaw.toLowerCase().trim();
      let groundMatch;

      // "MainGround.SubGround" lets the caller disambiguate a sub-ground directly.
      if (wantedGround.includes(".")) {
        const dotIndex = wantedGround.indexOf(".");
        const wantedMain = wantedGround.slice(0, dotIndex).trim();
        const wantedSub = wantedGround.slice(dotIndex + 1).trim();
        const mainForSub = mainGrounds.find(g => String(g.name).toLowerCase() === wantedMain);

        if (mainForSub) {
          groundMatch = mainForSub.subGrounds.find(s => String(s.name).toLowerCase() === wantedSub)
            || mainForSub.subGrounds.find(s => String(s.name).toLowerCase().includes(wantedSub));
        }
      }

      if (!groundMatch) {
        // Only leaf-level nodes are matched: main grounds without subs, plus every sub-ground.
        const leafMains = mainGrounds.filter(g => !g.subGrounds.length);
        const candidates = [...leafMains, ...allSubGrounds];

        const exact = candidates.filter(g => String(g.name).toLowerCase() === wantedGround);
        const matched = exact.length ? exact : candidates.filter(g => String(g.name).toLowerCase().includes(wantedGround));

        if (matched.length > 1) {
          return { ambiguous: matched.map(qualifiedName) };
        }

        groundMatch = matched[0];

        if (!groundMatch) {
          const parentWithSubs = mainGrounds.find(g => g.subGrounds.length && String(g.name).toLowerCase() === wantedGround);

          if (parentWithSubs) {
            return { needsSub: parentWithSubs.subGrounds.map(s => s.name), parentName: parentWithSubs.name };
          }

          return { notFound: true };
        }
      }

      return { match: groundMatch };
    }

    // Templates are per employee. The subordinate's own token is what the screen pairs with
    // the employee picker; the page's selected-employee field is tried second.
    const templateCandidates = [employee.empNumber, pageSelectedEmpNumber].filter((v, i, a) => v && a.indexOf(v) === i);
    let templates = null;
    let templatesError = "";

    for (const candidate of templateCandidates) {
      const tRes = await getJson(`${base}/GrievanceV9/RecordGrievance/GetTemplateHeads?empNumber=${encodeURIComponent(candidate)}`, "GetTemplateHeads");

      if (!tRes.error && Array.isArray(tRes.data)) {
        templates = tRes.data;
        break;
      }

      templatesError = tRes.error || "unexpected response";
    }

    if (templates === null) {
      return context({ error: "Could not load the grievance templates for this employee - please try again.", detail: templatesError });
    }

    if (!templates.length) {
      return context({ message: `No grievance templates are available for ${employeeName}. Please contact your HR administrator.` });
    }

    let template;

    if (args.templateName) {
      const wantedTemplate = String(args.templateName).toLowerCase().trim();

      template = templates.find(t => String(t.tempName).toLowerCase() === wantedTemplate)
        || templates.find(t => String(t.tempName).toLowerCase().includes(wantedTemplate));

      if (!template) {
        return context({ message: `Could not find a grievance template matching "${args.templateName}". Available templates: ${templates.map(t => t.tempName).join(", ")}` });
      }
    } else if (templates.length === 1) {
      template = templates[0];
    } else {
      return context({ message: `Multiple grievance templates are available: ${templates.map(t => t.tempName).join(", ")}. Ask the user which one to use and call this tool again with templateName set.` });
    }

    // Channel members depend on the resolved template and the employee - fetched before
    // ground is checked, so they are included in every response from here on.
    const channelRes = await postJson(`${base}/GrievanceV9/Common/GetTemplateChannelDetails`, {
      tempCode: template.tempCode,
      recHeadCode: recHeadCode,
      pageName: "Application",
      grievanceEmpNumber: employee.empNumber
    }, "GetTemplateChannelDetails");

    if (channelRes.error || !Array.isArray(channelRes.data)) {
      return context({ template: template.tempName, error: "Could not load the channel members for this template - please try again." });
    }

    const channelMembers = channelRes.data;

    const bypassList = Array.isArray(args.bypassChannelMembers) ? args.bypassChannelMembers : [];
    const bypassWanted = bypassList.map(n => String(n).toLowerCase().trim()).filter(Boolean);
    const unmatchedBypass = [];

    bypassWanted.forEach(w => {
      const hits = channelMembers.filter(m => {
        const name = (m.empDisplayName || "").trim().toLowerCase();
        return name === w || name.includes(w) || m.empDisplayNumber === w;
      });

      if (!hits.length) {
        unmatchedBypass.push(w);
      }

      hits.forEach(m => {
        m.status_old = m.status;
        m.statusCSS_old = m.statusCSS;
        m.status = "Bypassed";
        m.statusCSS = "label label-bypassed";
        m.chkstatus = 1;
      });
    });

    const previewChannelMembers = channelMembers.map(m => ({
      empDisplayName: (m.empDisplayName || "").trim(),
      designation: m.designation,
      priorityOrder: m.tempPriorityOrder,
      status: m.status
    }));

    if (unmatchedBypass.length) {
      return context({
        error: `Could not find ${unmatchedBypass.map(n => `"${n}"`).join(", ")} among the channel members to bypass. Ask the user to choose from: ${previewChannelMembers.map(m => m.empDisplayName).join(", ")}.`,
        template: template.tempName,
        channelMembers: previewChannelMembers
      });
    }

    if (channelMembers.length && channelMembers.every(m => m.status === "Bypassed")) {
      return context({
        error: "You are not allowed to bypass all the channels in grievance application. At least one channel member must remain.",
        template: template.tempName,
        channelMembers: previewChannelMembers
      });
    }

    /* ---------------------------------------------------------------------
     * Step 5: ground, summary, description, mood.
     * ------------------------------------------------------------------- */
    if (!args.ground) {
      return context({
        message: `ground is required. Available grounds: ${describeGrounds()}`,
        template: template.tempName,
        channelMembers: previewChannelMembers
      });
    }

    const resolved = resolveGround(String(args.ground));

    if (resolved.ambiguous) {
      return context({
        message: `More than one grievance ground matches "${args.ground}": ${resolved.ambiguous.join(", ")}. Ask the user which one and call again with the exact name (use "MainGround.SubGround" if needed).`,
        template: template.tempName,
        channelMembers: previewChannelMembers
      });
    }

    if (resolved.needsSub) {
      return context({
        message: `"${resolved.parentName}" has sublevel grounds - ask the user to pick one: ${resolved.needsSub.join(", ")}.`,
        template: template.tempName,
        channelMembers: previewChannelMembers
      });
    }

    if (!resolved.match) {
      return context({
        message: `Could not find a grievance ground matching "${args.ground}". Available grounds: ${describeGrounds()}`,
        template: template.tempName,
        channelMembers: previewChannelMembers
      });
    }

    const groundMatch = resolved.match;
    groundMatch.node.isChecked = true;
    const groundDisplay = qualifiedName(groundMatch);

    function progress(extra) {
      return context(Object.assign({ template: template.tempName, ground: groundDisplay, channelMembers: previewChannelMembers }, extra));
    }

    const summaryText = typeof args.summary === "string" ? args.summary.trim() : "";
    const descriptionText = typeof args.description === "string" ? args.description : "";

    if (!summaryText) {
      return progress({ error: "summary is required - a short summary of the grievance." });
    }

    if (!descriptionText.trim()) {
      return progress({ error: "description is required - the full description/details of the grievance." });
    }

    const mood = Number(args.moodRating);

    if (args.moodRating === undefined || args.moodRating === null || args.moodRating === "") {
      return progress({ error: "moodRating is required - ask the user for the employee's current mood (1-5) before submitting." });
    }

    if (!Number.isInteger(mood) || mood < 1 || mood > 5) {
      return progress({ error: "moodRating must be a whole number from 1 (very unhappy) to 5 (very happy). Ask the user again." });
    }

    /* ---------------------------------------------------------------------
     * Step 6: attachments. No size or file-type limit is hardcoded here: both are configured
     * per client and enforced by RecordGrievance/AttachmentUpload itself, which answers a
     * rejected file with the module's own plain-text message, relayed verbatim below.
     * ------------------------------------------------------------------- */
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
    const attachmentTitles = args.attachmentTitles && typeof args.attachmentTitles === "object" ? args.attachmentTitles : {};

    // A title is mandatory per attachment ('Attachment Title cannot be empty.') and is always
    // asked for explicitly. Keyed by file name so multiple attachments never get mixed up.
    if (attachedFiles.length) {
      const missingTitles = attachedFiles
        .map(f => f.name)
        .filter(name => !attachmentTitles[name] || !String(attachmentTitles[name]).trim());

      if (missingTitles.length) {
        return progress({
          message: `Please provide a title for ${missingTitles.length > 1 ? "each of these attachments" : "this attachment"}: ${missingTitles.join(", ")}. Pass them in attachmentTitles, keyed by file name (e.g. {"${missingTitles[0]}": "Medical certificate"}).`
        });
      }
    }

    const attachmentPreview = attachedFiles.map(f => ({
      fileName: f.name,
      title: attachmentTitles[f.name]
    }));

    /* ---------------------------------------------------------------------
     * Step 7: preview first - nothing is uploaded or submitted without confirmed:true.
     * ------------------------------------------------------------------- */
    if (!args.confirmed) {
      return progress({
        preview: true,
        message: `Review this grievance with the user before submitting. It will be submitted on behalf of ${employeeName}. Call this tool again with confirmed:true (and the same arguments) once they agree.`,
        summary: summaryText,
        description: descriptionText,
        hideIdentity: !!args.hideIdentity,
        moodRating: mood,
        attachments: attachmentPreview
      });
    }

    for (const file of attachedFiles) {
      const uploadFormData = new FormData();

      uploadFormData.append("uploadFile", file, file.name);
      uploadFormData.append("fileTypedName", attachmentTitles[file.name]);
      uploadFormData.append("fileName", file.name);
      uploadFormData.append("recHeadCode", recHeadCode);

      let uploadText = "";

      try {
        // No content-type header on purpose - FormData sets its own multipart boundary.
        const uploadRes = await fetch(`${base}/GrievanceV9/RecordGrievance/AttachmentUpload`, {
          method: "POST",
          headers: { "accept": "application/json, text/plain, */*" },
          body: uploadFormData,
          redirect: "follow"
        });

        uploadText = (await uploadRes.text()).trim();
      } catch (e) {
        uploadText = "";
      }

      if (uploadText.toLowerCase() !== "ok") {
        return progress({
          error: `Could not attach "${file.name}": ${uploadText || "The server rejected this file."}`,
          attachmentRejected: true,
          fileName: file.name
        });
      }
    }

    // Audio is optional. When disabled, this block is skipped entirely.
    if (args && (args.isAudioRecorded === true || args.isAudioRecorded === "true")) {
      try {
        const audioResult = await BeaconBar.executeFunction("audioRecordFunction")(recHeadCode, base);

        if (!audioResult || audioResult.success !== true) {
          return progress({ error: true, message: "Audio recording failed. Please try again." });
        }
      } catch (audioError) {
        return progress({ error: true, message: "Audio recording failed. Please try again." });
      }
    }

    /* ---------------------------------------------------------------------
     * Step 8: submit. The grievance is raised FOR the subordinate: createdEmpNumber is the
     * subordinate's own token, the same one used as grievanceEmpNumber for the channel lookup
     * (confirmed live - the two are identical in the captured Submit).
     * ------------------------------------------------------------------- */
    let submitText = "";

    try {
      const submitRes = await fetch(`${base}/GrievanceV9/RecordGrievance/Submit`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          recModel: {
            recHeadCode: recHeadCode,
            tempCode: template.tempCode,
            recDesc: descriptionText,
            recSummary: summaryText,
            recHideIdentity: !!args.hideIdentity,
            createdEmpNumber: employee.empNumber,
            emojiRating: mood,
            channelmems: channelMembers
          },
          sources: sources
        }),
        redirect: "follow"
      });

      submitText = (await submitRes.text()).trim();
    } catch (e) {
      return progress({ error: "The submission could not be completed because the server could not be reached. The grievance was not submitted - please try again." });
    }

    if (submitText.toLowerCase() !== "ok") {
      const readable = /^\s*</.test(submitText) ? "" : submitText.slice(0, 300);

      return progress({
        error: `The grievance for ${employeeName} was not submitted${readable ? `: ${readable}` : "."} Please try again, or contact your HR administrator if it keeps happening.`
      });
    }

    let attachmentsResult = attachmentPreview;

    if (attachedFiles.length) {
      const attRes = await postJson(`${base}/GrievanceV9/RecordGrievance/GetAttachmentLists`, { recHeadCode: recHeadCode }, "GetAttachmentLists");

      // Display-only: the uploads already succeeded above, so a failure here is not a submission risk.
      if (!attRes.error && Array.isArray(attRes.data)) {
        attachmentsResult = attRes.data.map(a => ({
          attId: a.attId,
          fileName: a.attName,
          title: a.attDescription
        }));
      }
    }

    return progress({
      submitted: true,
      recHeadCode: recHeadCode,
      summary: summaryText,
      description: descriptionText,
      hideIdentity: !!args.hideIdentity,
      moodRating: mood,
      attachments: attachmentsResult
    });
  } catch (unexpected) {
    return {
      error: "Something went wrong while preparing this grievance, and nothing was submitted. Please try again, or contact your HR administrator if it keeps happening.",
      detail: String((unexpected && unexpected.message) || unexpected)
    };
  }
})
