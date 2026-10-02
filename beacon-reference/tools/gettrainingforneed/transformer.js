(async function (data, args, reqOptions) {
  try {
    const menus = (typeof BeaconBar !== "undefined" && BeaconBar.user && BeaconBar.user.metaData && BeaconBar.user.metaData.menus) || [];
    const hasAccess = Array.isArray(menus) && menus.some((menu) => typeof menu === "string" && menu.includes("TNDV9/NeedConverter/Index?mvc=1&bs=4"));
    if (!hasAccess) {
      return {
        status: "NO_ACCESS",
        message: "It seems you don't have access. Please check with the HR Admin"
      };
    }

    const keyword = args.keyword ? String(args.keyword).trim().toLowerCase() : "";

    function tokenize(text) {
      return (text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    }
    function containsAllWords(haystackText, words) {
      if (words.length === 0) return false;
      const haystackWords = tokenize(haystackText);
      return words.every((w) => haystackWords.some((hw) => hw.includes(w)));
    }
    const keywordWords = tokenize(keyword);

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

    const needData = await postJson("TNDV9/NeedConverter/GetNeedConverterDetails", undefined);
    if (!needData || !needData.Status || needData.Status.IsSuccessfull !== true) {
      return {
        status: "ERROR",
        message: (needData && needData.Status && needData.Status.Message) || "Failed to retrieve training needs"
      };
    }

    const convertList = Array.isArray(needData.ConvertList) ? needData.ConvertList : [];
    const notConvertList = Array.isArray(needData.NotConvertList) ? needData.NotConvertList : [];
    const completeList = Array.isArray(needData.CompleteList) ? needData.CompleteList : [];

    const allRequests = [
      ...convertList.map((r) => Object.assign({ _stage: "Convertible" }, r)),
      ...notConvertList.map((r) => Object.assign({ _stage: "NotConvertible" }, r)),
      ...completeList.map((r) => Object.assign({ _stage: "Completed" }, r))
    ];

    const categoriesByCode = {};
    allRequests.forEach((r) => {
      const code = r.needcode || "";
      if (!categoriesByCode[code]) {
        categoriesByCode[code] = {
          needCode: code,
          needName: r.needname || "",
          assignedCourseName: "",
          requests: []
        };
      }
      const category = categoriesByCode[code];
      if (r.course && !category.assignedCourseName) {
        category.assignedCourseName = r.course;
      }
      category.requests.push({
        requestNeed: r.requestneed || "",
        needDescription: r.needdesc || "",
        objective: r.objective || "",
        requestedBy: r.empname || "",
        requestedByEmployeeNumber: r.displayempno || "",
        applicationDate: r.appdate || "",
        conversionStatus: r._stage
      });
    });

    let categories = Object.values(categoriesByCode).map((category) => ({
      needCode: category.needCode,
      needName: category.needName,
      conversionStatus: category.assignedCourseName ? "Completed" : (category.requests.some((r) => r.conversionStatus === "Convertible") ? "Convertible" : "NotConvertible"),
      assignedCourseName: category.assignedCourseName || null,
      requests: category.requests
    }));

    if (keywordWords.length > 0) {
      categories = categories.filter((category) =>
        containsAllWords(category.needName, keywordWords) ||
        category.requests.some((r) =>
          containsAllWords(`${r.requestNeed} ${r.needDescription}`, keywordWords)
        )
      );
    }

    const categoriesNeedingCourseLookup = keywordWords.length > 0
      ? categories.filter((c) => !c.assignedCourseName)
      : [];
    if (categoriesNeedingCourseLookup.length > 0) {
      const coursesData = await postJson("TNDV9/Course/GetAllCourses", { WFMainID: "" });
      const courses = (coursesData && Array.isArray(coursesData.Courses)) ? coursesData.Courses : [];
      categoriesNeedingCourseLookup.forEach((category) => {
        const categoryWords = tokenize(category.needName);
        const match = courses.find((c) =>
          containsAllWords(`${c.CosTitle || ""} ${c.CosDesc || ""}`, categoryWords)
        );
        if (match) {
          category.assignedCourseName = match.CosTitle || match.CosDesc || "";
          category.possibleCourseMatchIsInferred = true;
          category.conversionStatus = "Completed";
        }
      });
    }

    if (categories.length === 0) {
      return {
        status: "SUCCESS",
        message: keyword
          ? `No training need matching "${args.keyword}" was found.`
          : "No training needs are currently on file.",
        needCategories: []
      };
    }

    return {
      status: "SUCCESS",
      message: `Found ${categories.length} matching training need categor${categories.length === 1 ? "y" : "ies"}.`,
      needCategories: categories
    };

  } catch (error) {
    const errorMessage = error && error.message ? error.message : String(error);
    return {
      status: "ERROR",
      message: `Failed to retrieve training needs: ${errorMessage}`,
      error: errorMessage
    };
  }
})
