(async function (data, args, reqOptions) {
  // Same evidence as selfEmployeeBenefitApllication: only these control types are ever
  // user-edited (diffing GetApplicationStructure's response against SaveApplication's
  // request for the same field showed "7"/"VL" always echoed back unchanged, "0" is a
  // structural divider with no display name).
  const EDITABLE_CTRL_TYPES = ["2", "3", "5"];

  const benefitHeaders = new Headers();
  benefitHeaders.append("Accept", "application/json, text/javascript, */*; q=0.01");
  benefitHeaders.append("Content-Type", "application/json; charset=UTF-8");
  benefitHeaders.append("X-Requested-With", "XMLHttpRequest");

  // CommonComponents/Search endpoints are a different surface from BenefitV9's own API -
  // confirmed by capture: they take the jQuery-style accept string, not BenefitV9's.
  const commonComponentsHeaders = new Headers();
  commonComponentsHeaders.append("accept", "*/*");
  commonComponentsHeaders.append("content-type", "application/json; charset=UTF-8");
  commonComponentsHeaders.append("x-requested-with", "XMLHttpRequest");

  // Reads a fetch Response as JSON but never throws - a benefit type this tool hasn't
  // been captured against (e.g. one needing extra setup before GetApplicationStructure
  // will answer) can return an HTML error/login page or a non-2xx status instead of the
  // expected JSON; without this, that surfaces as an opaque, unhelpful crash instead of
  // a specific, actionable message naming which call failed and why.
  async function readJson(response, label) {
    const text = await response.text();
    try {
      return { data: JSON.parse(text) };
    } catch (e) {
      return { error: `${label} did not return usable data (HTTP ${response.status}). First 300 chars: ${text.slice(0, 300) || "(empty response)"}` };
    }
  }

  /* -------------------------------------------------
   * Step 1: load the "Apply Benefit for Team" bootstrap page and scrape its
   * window.BenefitApplicationObj blob - confirmed via capture to be mode=0 (NOT mode=2,
   * which the old, broken employeeBenefitApplication tool used for a different screen).
   * This blob's SearchModalHeader ("Apply Benefit for Team") and SearchQueryMode
   * ("subordinatesonly") confirm this is the correct entry point for this tool.
   * ------------------------------------------------- */
  const updateUrl = await BeaconBar.executeFunction("updateUrlParams")("Benefitv9/Application/Application/?mode=0&mvc=1");
  const pageDigest = await BeaconBar.executeFunction("getDigest")(updateUrl && updateUrl.updateParams);
  const pageUrl = `${location.origin}/${reqOptions.sl}/${(updateUrl && updateUrl.updateUrl) || "Benefitv9/Application/Application/?mode=0&mvc=1"}&digest=${pageDigest.digest}`;

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

  if (!blob || !blob.LogEmpNumber || !blob.KeyValue) {
    return `Could not initialize the Team Benefit Application page (HTTP ${pageRes.status}) - please try again.`;
  }

  /* -------------------------------------------------
   * Step 2: load the subordinate-search WIDGET itself and use ITS OWN issued
   * EmpNumber/KeyValue pair - NOT BenefitApplicationObj's. Confirmed by capture: the
   * request actually sent to GetSubordinatesByEmpNumber carried a KeyValue
   * ("a9987c3f-...") that does not match BenefitApplicationObj's own KeyValue
   * ("fc2c5818-..."), and its empNumber, while it decrypts to the same identity as
   * LogEmpNumber, is a distinct re-encryption - not reusable interchangeably. This is
   * the exact same "the component issues its own key/EmpNumber pair on render" gotcha
   * documented in the live subordinatesLeaveapplication tool for the Absence module's
   * own subordinate search widget. Only the digest computation is unconfirmed by a
   * direct second capture (no second example to diff against) - if this still returns
   * wrong data, re-capture this specific request fresh and compare.
   * ------------------------------------------------- */
  function onlyEscapeEquals(s) {
    return String(s || "").replace(/=/g, "%3D");
  }

  const searchParams = `empNumber=${onlyEscapeEquals(blob.LogEmpNumber)}&callBack=${blob.CallBackMethod}&searchMode=0&searchQueryMode=subordinatesonly&searchQueryState=activeonly&breadCrumbEnable=0&isDivLoading=1&isShowDisplayName=0&divId=searchBenDiv2&searchToken=${blob.searchToken}`;
  const searchDigest = await BeaconBar.executeFunction("getDigest")(searchParams);
  const searchUrl = `${location.origin}/${reqOptions.sl}/CommonComponents/Search/Search?${searchParams}&digest=${searchDigest.digest}&_=${Date.now()}`;

  const searchRes = await fetch(searchUrl, {
    method: "GET",
    headers: { "accept": "text/html, */*; q=0.01", "x-requested-with": "XMLHttpRequest" },
    redirect: "follow"
  });
  const searchHtml = await searchRes.text();
  const smartMatch = searchHtml.match(/window\.smartSearchModelObj\s*=\s*'([\s\S]*?)';/);
  let smartModel = null;
  if (smartMatch) {
    try { smartModel = JSON.parse(smartMatch[1]); } catch (e) { smartModel = null; }
  }

  if (!smartModel || !smartModel.EmpNumber || !smartModel.KeyValue) {
    return `Could not initialize the team search widget (HTTP ${searchRes.status}) - please try again.`;
  }

  /* -------------------------------------------------
   * Step 3: this supervisor's direct subordinates, using the search widget's own
   * EmpNumber/KeyValue pair from Step 2 (not BenefitApplicationObj's). Confirmed via
   * capture: this single call returns every direct report in one shot (no pagination
   * in the evidence seen), and its EmpNumber tokens are used AS-IS by
   * GetApplicationByEmployee/GetApplicationStructure/SaveApplication further down - no
   * separate encryption step for those. Scoping employee resolution to this list is
   * what satisfies "only a permitted direct subordinate" - an employee not in this
   * list simply never resolves, by construction.
   * ------------------------------------------------- */
  const subordinatesRes = await fetch(`${location.origin}/${reqOptions.sl}/CommonComponents/Search/GetSubordinatesByEmpNumber/`, {
    method: "POST",
    headers: commonComponentsHeaders,
    body: JSON.stringify({ empNumber: smartModel.EmpNumber, key: smartModel.KeyValue }),
    redirect: "follow"
  });
  const subordinatesResult = await readJson(subordinatesRes, "GetSubordinatesByEmpNumber");
  if (subordinatesResult.error) return subordinatesResult.error;
  const subordinates = subordinatesResult.data;
  const team = (subordinates || []).map(s => ({
    empNumber: s.EmpNumber,
    displayNumber: s.EmpDisplayNumber,
    displayName: (s.EmpDisplayName || "").trim()
  }));

  if (team.length === 0) {
    return "You have no direct subordinates to apply a benefit for. If you meant to apply for yourself, use selfEmployeeBenefitApllication instead.";
  }

  /* -------------------------------------------------
   * Step 4: identify the team member. Never falls back to an org-wide search - only
   * matched against this supervisor's own direct-subordinate list, so an employee who
   * is not a permitted direct subordinate can never be resolved by this tool at all.
   * ------------------------------------------------- */
  const wantedNumber = (args.employeeNumber || "").toLowerCase().trim();
  const wantedName = (args.employeeName || "").toLowerCase().trim();

  function matchTeamMember() {
    if (!wantedNumber && !wantedName) return team.length === 1 ? [team[0]] : null;
    let matches = [];
    if (wantedNumber) {
      matches = team.filter(t => t.displayNumber.toLowerCase() === wantedNumber);
    }
    if (matches.length === 0 && wantedName) {
      matches = team.filter(t => t.displayName.toLowerCase() === wantedName);
      if (matches.length === 0) matches = team.filter(t => t.displayName.toLowerCase().includes(wantedName));
    }
    return matches;
  }

  const matches = matchTeamMember();

  if (matches === null) {
    return {
      needsInput: true,
      message: "Which team member would you like to apply a benefit for? Here is your team. (For your own benefit application, use selfEmployeeBenefitApllication instead.)",
      teamMembers: team.map(t => ({ employeeNumber: t.displayNumber, employee: t.displayName }))
    };
  }
  if (matches.length === 0) {
    return {
      error: true,
      message: `"${args.employeeNumber || args.employeeName}" is not one of your direct subordinates. Here is your team - please pick one of these.`,
      teamMembers: team.map(t => ({ employeeNumber: t.displayNumber, employee: t.displayName }))
    };
  }
  if (matches.length > 1) {
    return {
      needsInput: true,
      message: `"${args.employeeNumber || args.employeeName}" matches more than one team member. Please tell me which one.`,
      candidates: matches.map(t => ({ employeeNumber: t.displayNumber, employee: t.displayName }))
    };
  }

  const employee = matches[0];

  /* -------------------------------------------------
   * Step 5: this specific employee's own available benefit types - not a generic list.
   * Confirmed via capture that a supervisor and a self-service caller see different
   * benefit types for different employees, so this must be re-fetched per employee.
   * ------------------------------------------------- */
  const byEmployeeRes = await fetch(`${location.origin}/${reqOptions.sl}/BenefitV9/api/ApplicationApi/GetApplicationByEmployee`, {
    method: "POST",
    headers: benefitHeaders,
    body: JSON.stringify({ empNumber: employee.empNumber, key: blob.KeyValue, type: 0, mode: "0" }),
    redirect: "follow"
  });
  const byEmployeeResult = await readJson(byEmployeeRes, "GetApplicationByEmployee");
  if (byEmployeeResult.error) return byEmployeeResult.error;
  const byEmployee = byEmployeeResult.data;
  const benefitTypes = byEmployee.benefitTypes || [];

  if (benefitTypes.length === 0) {
    return `${employee.displayName} has no benefit types available to apply for. Please check with HR Admin.`;
  }

  if (!args.benefitType) {
    return `benefitType is required. Available benefit types for ${employee.displayName}: ${benefitTypes.map(b => b.BetName).join(", ")}`;
  }

  const wantedType = args.benefitType.toLowerCase();
  const typeMatch = benefitTypes.find(b => b.BetName.toLowerCase() === wantedType)
    || benefitTypes.find(b => b.BetName.toLowerCase().includes(wantedType));

  if (!typeMatch) {
    return `"${args.benefitType}" is not available for ${employee.displayName}. Available benefit types: ${benefitTypes.map(b => b.BetName).join(", ")}`;
  }

  /* -------------------------------------------------
   * Step 6: the employee's application structure for this benefit type. Every field
   * here (visibilityState "1", isWorkflow "0", appId/wfMainId/cancelWfMainId from the
   * bootstrap blob) is the exact literal shape confirmed by capture - identical to the
   * self-service tool's, despite coming from a different (supervisor) bootstrap page.
   * ------------------------------------------------- */
  const structureRes = await fetch(`${location.origin}/${reqOptions.sl}/BenefitV9/api/ApplicationApi/GetApplicationStructure/`, {
    method: "POST",
    headers: benefitHeaders,
    body: JSON.stringify({
      betCode: typeMatch.BetCode,
      empNumber: employee.empNumber,
      visibilityState: blob.VisibilityState || "1",
      isWorkflow: blob.IsWorkflow || "0",
      appId: blob.AppId,
      wfMainId: blob.WfMainId || null,
      cancelWfMainId: blob.CancelWfMainId || null,
      keyValue: blob.KeyValue,
      BetAppYear: blob.BetAppYear
    }),
    redirect: "follow"
  });
  const structureResult = await readJson(structureRes, "GetApplicationStructure");
  if (structureResult.error) return structureResult.error;
  const structure = structureResult.data;

  // Editable fields the user can set, plus read-only info fields (Entitlement, Utilized
  // Amount, Department, etc.) surfaced for display only - satisfies "show entitlement/
  // utilized amount where relevant" without asking the user for them.
  const fields = [];
  const infoFields = [];
  let hasUnsupportedGrid = false;
  (structure.applicationRowVms || []).forEach(row => {
    (row.ApplicationStructureRowVms || []).forEach(ctrl => {
      if (ctrl.IsGridDef || ctrl.BesIsGridControl === 1) {
        hasUnsupportedGrid = true;
        return;
      }
      if (!ctrl.BesDisplayName) return;
      if (EDITABLE_CTRL_TYPES.includes(ctrl.BesCtrlType)) {
        fields.push({
          besId: ctrl.BesId,
          displayName: ctrl.BesDisplayName,
          mandatory: ctrl.BesIsMandatory === "mandatory",
          dataType: ctrl.BesDataType,
          ctrlType: ctrl.BesCtrlType,
          options: (ctrl.RefObjectValue || []).map(o => o.Value),
          ref: ctrl
        });
      } else if (ctrl.BesCtrlType === "7" || ctrl.BesCtrlType === "VL") {
        infoFields.push({ displayName: ctrl.BesDisplayName, value: ctrl.RefDisplayValue || ctrl.RefValue });
      }
    });
  });

  if (hasUnsupportedGrid) {
    return `The "${typeMatch.BetName}" benefit type includes a table/grid section (e.g. a list of claims or dependent enrollments) that this tool doesn't support yet. Please use the Benefit Management screen directly for this benefit type.`;
  }

  const betInfo = structure.currentBenefitType || {};

  if (betInfo.BetAttachmentMandatoryFlg === 1 || betInfo.BetAttachmentMandatoryFlg === "1") {
    return `The "${typeMatch.BetName}" benefit type requires a file attachment, which this tool cannot upload. Please use the Benefit Management screen directly for this benefit type.`;
  }

  if (!args.fieldValues) {
    return {
      discovery: true,
      message: `Ask the supervisor for each mandatory field below (plus any optional ones they want to set) for ${employee.displayName}, then call this tool again with the same employeeNumber/employeeName and benefitType and a fieldValues object keyed by each field's displayName exactly as shown. For dropdown fields, use the option's text, not an internal code.`,
      employee: employee.displayName,
      employeeNumber: employee.displayNumber,
      benefitType: typeMatch.BetName,
      commentMandatory: betInfo.BetCommentMandatoryFlg === "1",
      showComment: betInfo.BetshowAppCommentBox === "1",
      confirmMessage: betInfo.IsConfirmNeed === "1" ? betInfo.ConfirmMessage : null,
      info: infoFields,
      fields: fields.map(f => ({
        displayName: f.displayName,
        mandatory: f.mandatory,
        dataType: f.dataType,
        currentValue: f.ref.RefValue,
        options: f.options.length ? f.options : undefined
      }))
    };
  }

  const missingMandatory = fields.filter(f => f.mandatory && !(f.displayName in args.fieldValues));
  if (missingMandatory.length > 0) {
    return `Missing required field(s) for ${employee.displayName}'s "${typeMatch.BetName}" application: ${missingMandatory.map(f => f.displayName).join(", ")}. Call this tool again with these included in fieldValues.`;
  }

  for (const [name, value] of Object.entries(args.fieldValues)) {
    const field = fields.find(f => f.displayName.toLowerCase() === name.toLowerCase());
    if (!field) {
      return `"${name}" is not a field on the "${typeMatch.BetName}" benefit type. Valid fields: ${fields.map(f => f.displayName).join(", ")}`;
    }
    if (field.ctrlType === "3") {
      const opt = (field.ref.RefObjectValue || []).find(o => String(o.Value).toLowerCase() === String(value).toLowerCase());
      if (!opt) {
        return `"${value}" is not a valid option for "${field.displayName}". Valid options: ${(field.ref.RefObjectValue || []).map(o => o.Value).join(", ")}`;
      }
      field.ref.RefValue = opt.Id;
    } else {
      field.ref.RefValue = value;
    }
  }

  if (betInfo.BetCommentMandatoryFlg === "1" && !args.comment) {
    return `Error: comment is required for ${employee.displayName}'s "${typeMatch.BetName}" application.`;
  }

  if (!args.confirmed) {
    return {
      preview: true,
      message: `Review this application for ${employee.displayName} with the supervisor before submitting - make clear it will be submitted on ${employee.displayName}'s behalf. Call this tool again with confirmed:true (and the same arguments) once they agree.`,
      employee: employee.displayName,
      employeeNumber: employee.displayNumber,
      benefitType: typeMatch.BetName,
      confirmMessage: betInfo.IsConfirmNeed === "1" ? betInfo.ConfirmMessage : null,
      info: infoFields,
      fields: fields.map(f => ({
        displayName: f.displayName,
        value: f.ctrlType === "3"
          ? ((f.ref.RefObjectValue || []).find(o => o.Id === f.ref.RefValue)?.Value ?? f.ref.RefValue)
          : f.ref.RefValue
      })),
      comment: args.comment || null
    };
  }

  // Confirmed request shape via capture (same 7 keys as the self-service flow, this
  // time CurrentEmployeeNumber is the subordinate's token, not the supervisor's own).
  const saveRes = await fetch(`${location.origin}/${reqOptions.sl}/BenefitV9/api/ApplicationApi/SaveApplication/`, {
    method: "POST",
    headers: benefitHeaders,
    body: JSON.stringify({
      ApplicationRowVms: structure.applicationRowVms,
      CurrentEmployeeNumber: employee.empNumber,
      CurrentBenefitTypeCode: typeMatch.BetCode,
      BetCommentMandatoryFlg: betInfo.BetCommentMandatoryFlg || "0",
      ApplicantComment: args.comment || null,
      VisibilityState: blob.VisibilityState || "1",
      KeyValue: blob.KeyValue
    }),
    redirect: "follow"
  });
  const saveJsonResult = await readJson(saveRes, "SaveApplication");
  if (saveJsonResult.error) return saveJsonResult.error;
  const saveResult = saveJsonResult.data;

  return {
    submitted: !!saveResult.Status,
    message: saveResult.Message
      ? `Submitted on behalf of ${employee.displayName}: ${saveResult.Message}`
      : saveResult.Message,
    employee: employee.displayName,
    benefitType: typeMatch.BetName
  };
})
