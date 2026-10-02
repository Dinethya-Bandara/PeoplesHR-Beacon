(async function (data, args, reqOptions) {
  if (!BeaconBar.user.metaData.menus.some(menu =>menu.includes("AbsenceV9/LeaveHistory/LeaveHistory?mvc=1"))) {
    return "It seems you don't have access. Please check with the HR Admin";
  }

  const empKey = await BeaconBar.executeFunction("employeeLeaveApplication")();

  const myHeaders = new Headers();
  myHeaders.append("__cfafvalue", window.csrf);
  myHeaders.append("accept", "*/*");
  myHeaders.append("accept-language", "en-US,en;q=0.9");
  myHeaders.append("Content-Type", "application/json");
  myHeaders.append("x-requested-with", "XMLHttpRequest");

  const approverResponse = await fetch(
    `${location.origin}/${reqOptions.sl}/AbsenceV9/api/LeaveApplication/GetApprovalPerson/`,
    {
      method: "POST",
      headers: myHeaders,
      body: JSON.stringify({
        EmpNumber: empKey,
        LeaveGroup: args.leaveGroupCode,
        LeaveYear: args.year,
        LeaveType: args.leaveTypeCode,
        ApplicationPage: 1
      }),
      redirect: "follow"
    }
  );

  const approverData = await approverResponse.json();
  const approverNumber = approverData.EmpNumber || "";

  const calculateResponse = await fetch(
    `${location.origin}/${reqOptions.sl}/AbsenceV9/api/LeaveApplication/CalculateLeaveDays/`,
    {
      method: "POST",
      headers: myHeaders,
      body: JSON.stringify({
        EmpNumber: empKey,
        LeaveGroup: args.leaveGroupCode,
        LeaveYear: args.year,
        LeaveType: args.leaveType,
        FromDateText: args.fromDate,
        ToDateText: args.toDate,
        IsAllDaysEditable: true,
        BreakdownList: [],
        EarnedLeaveList: [],
        NotificationList: [],
        MedicalIssueDateText: "",
        Attachment: { AttachmentName: "-1" },
        Attachments: null,
        Date_1_Text: "",
        Date_2_Text: "",
        Date_3_Text: "",
        Date_4_Text: "",
        Date_5_Text: "",
        ApprovalEmpNumber: approverNumber,
        LoginEmpNumber: window.empLog,
        ApplicationPage: 1,
        ExtraMaternityDays: 0
      }),
      redirect: "follow"
    }
  );

  let calculateDetails = await calculateResponse.json();
  if (calculateDetails.Status === false) {
    return calculateDetails;
  }

  const leaveComment = (args.comment || args.Comment || "").trim();

  const inputLeaveReason = (args.leaveReason || args.LeaveReason || "").trim();

  const modelScript = [...document.querySelectorAll("script")]
  .map(s => s.textContent)
  .find(t => t.includes("var model ="));

  const modelMatch = modelScript?.match(/var\s+model\s*=\s*'([\s\S]*?)';/);

  const pageModel = modelMatch ? JSON.parse(modelMatch[1]) : null;

  const reasonOptions = (pageModel?.ReasonList || []).map(x => ({
    text: decodeURIComponent(x.Description || ""),
    value: x.ReasonCode
  }));

  const matchedReason = reasonOptions.find(
  x => x.text.toLowerCase() === inputLeaveReason.toLowerCase()
);

const leaveReason = matchedReason ? matchedReason.value : "";


    calculateDetails.BreakdownList?.forEach(x => {
      args.dayModes?.forEach(y => {
        if (x.LeaveDate === y.date) {
          x.DayValue = y.dayValue;
          x.DayMode = y.dayMode;
        }
      });
    });

  const sum = args.dayModes.reduce((total, x) => total + x.dayValue, 0);

  if (calculateDetails.Status) {
    const confirmed = args.confirmed === true
      || args.confirmed === 1
      || args.confirmed === "true";

    if (!confirmed) {
      const dayModeNames = { 2: "Whole Day", 1: "First Half", 0: "Second Half", 7: "Off Day" };

      return {
        needsConfirmation: true,
        Message: "Please check this leave application with the user and confirm before it is submitted. Nothing has been saved yet.",
        Preview: {
          fromDate: args.fromDate,
          toDate: args.toDate,
          totalDays: sum,
          days: (calculateDetails.BreakdownList || []).map(function (d) {
            return {
              date: d.LeaveDate,
              dayMode: dayModeNames[d.DayMode] || String(d.DayMode),
              dayValue: d.DayValue
            };
          }),
          comment: leaveComment,
          leaveReason: inputLeaveReason,
          coveringEmployeeGiven: !!args.coveringEmployeeCode,
          attachmentRequired: !!args.isAttachmentMandatory
        },
        ConfirmationPrompt: "Shall I submit this leave application? Reply yes to submit, or tell me what to change."
      };
    }

    let file1 = null;

    if (args.isAttachmentMandatory) {
      const baoFiles = BeaconBar.getUploadedBaoFiles();
      file1 = baoFiles[0] || null;
    }

    if (file1) {
      const formData = new FormData();
      formData.append(file1.name, file1, file1.name);

      const response = await fetch(`${location.origin}/${reqOptions.sl}/AbsenceV9/api/LeaveApplication/UploadLeaveAttachmentData/`, {
        method: "POST",
        headers: {
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: formData,
        credentials: "include",
        redirect: "follow"
      });

      const attachmentResult = await response.json();
      if (attachmentResult.Status !== true) {
        return attachmentResult;
      }
    }

    const hasAttachment = !!file1;

    const saveResponse = await fetch(`${location.origin}/${reqOptions.sl}/AbsenceV9/api/LeaveApplication/SaveLeaveApplication/`, {
      method: "POST",
      headers: myHeaders,
      body: JSON.stringify({
        EmpNumber: empKey,
        ApprovalEmpNumber: approverNumber,
        LeaveGroup: args.leaveGroupCode,
        LeaveYear: args.year,
        LeaveType: args.leaveTypeCode,
        FromDateText: args.fromDate,
        ToDateText: args.toDate,
        Comment: leaveComment,
        IsAllDaysEditable: true,
        LeaveAmount: sum,
        LeaveAmountToVldt: sum,
        BreakdownList: calculateDetails.BreakdownList,
        EarnedLeaveList: [],
        NotificationList: [],
        IsMedicalLeave: false,
        MedicalIssueDateText: "",
        Attachment: hasAttachment ? { AttachmentName: file1.name } : { AttachmentName: "-1" },
        Attachments: null,
        Date_1_Text: "",
        Date_2_Text: "",
        Date_3_Text: "",
        Date_4_Text: "",
        Date_5_Text: "",
        CoveringEmpNumber: args.coveringEmployeeCode,
        LeaveReason: leaveReason,
        LoginEmpNumber: window.empLog,
        ApplicationPage: 1,
        ExtraMaternityDays: 0
      }),
      redirect: "follow"
    });

    return await saveResponse.json();
  } else {
    return calculateDetails;
  }
});
