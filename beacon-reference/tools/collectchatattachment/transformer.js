(async function (data, args, reqOptions) {
  debugger
  const FILES_KEY = "peoplesHRChatAttachments";
  const SELECTED_KEY = "peoplesHRSelectedAttachment";
  const LOG_PREFIX = "[PeoplesHR DocumentSelection]";

  try {
    console.log(`${LOG_PREFIX} Starting attachment detection...`);
    console.log(`${LOG_PREFIX} Arguments:`, {
      fileSelection: args?.fileSelection ?? null
    });

    // Validate attachment helper availability.
    if (
      typeof BeaconBar === "undefined" ||
      typeof BeaconBar.getUploadedBaoFiles !== "function"
    ) {
      console.warn(`${LOG_PREFIX} Attachment collection helper is unavailable.`);

      return {
        success: false,
        fileDetected: false,
        helperAvailable: false,
        message: "Attachment collection is unavailable. Continue normal conversations without interruption. If the user's request requires a file, explain that the attachment could not be accessed."
      };
    }

    console.log(`${LOG_PREFIX} Attachment collection helper is available.`);

    // Validate shared data storage.
    if (typeof BeaconBar.setSharedData !== "function") {
      console.warn(`${LOG_PREFIX} Shared data storage is unavailable.`);

      return {
        success: false,
        fileDetected: false,
        helperAvailable: true,
        message: "Attachments can be checked, but shared data storage is unavailable. Do not claim that any file was saved."
      };
    }

    console.log(`${LOG_PREFIX} Shared data storage is available.`);

    // Read and normalize uploaded chat files.
    console.log(`${LOG_PREFIX} Fetching uploaded chat attachments...`);

    const rawFiles = await BeaconBar.getUploadedBaoFiles();

    console.log(`${LOG_PREFIX} Raw attachment response received.`, {
      responseType: typeof rawFiles,
      isArray: Array.isArray(rawFiles),
      count: Array.isArray(rawFiles) ? rawFiles.length : rawFiles ? 1 : 0
    });

    const files = (Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [])
      .filter(file => file && typeof file === "object" && file.name);

    console.log(`${LOG_PREFIX} Valid attachments detected: ${files.length}`);

    // Log attachment metadata only.
    files.forEach((file, index) => {
      console.log(`${LOG_PREFIX} Attachment ${index}:`, {
        name: file.name,
        size: file.size ?? null,
        type: file.type ?? null
      });
    });

    // No attachment: clear stale selection and continue normally.
    if (files.length === 0) {
      console.warn(`${LOG_PREFIX} No attachments detected. Clearing stale shared data.`);

      await BeaconBar.setSharedData(FILES_KEY, []);
      console.log(`${LOG_PREFIX} Cleared attachment list: ${FILES_KEY}`);

      await BeaconBar.setSharedData(SELECTED_KEY, null);
      console.log(`${LOG_PREFIX} Cleared selected attachment: ${SELECTED_KEY}`);

      console.log(`${LOG_PREFIX} Attachment check completed. No files found.`);

      return {
        success: true,
        fileDetected: false,
        helperAvailable: true,
        filesDetected: 0,
        message: "No chat attachment was detected. This is informational only; continue the user's request normally. Ask for a file only if the current task requires one."
      };
    }

    // Default to latest file; allow explicit zero-based index.
    const hasSelection =
      args?.fileSelection !== undefined &&
      args?.fileSelection !== null &&
      args?.fileSelection !== "";

    const selectedIndex = hasSelection
      ? Number(args.fileSelection)
      : files.length - 1;

    console.log(`${LOG_PREFIX} Selecting attachment:`, {
      selectionProvided: hasSelection,
      requestedIndex: hasSelection ? args.fileSelection : "latest",
      resolvedIndex: selectedIndex
    });

    // Validate selected index.
    if (
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= files.length
    ) {
      console.warn(`${LOG_PREFIX} Invalid fileSelection index.`, {
        selectedIndex,
        availableFiles: files.length
      });

      return {
        success: false,
        fileDetected: true,
        filesDetected: files.length,
        availableFiles: files.map((file, index) => ({
          index,
          name: file.name,
          size: file.size ?? null,
          type: file.type ?? null
        })),
        message: "Attachments were detected, but the requested fileSelection index is invalid. Select a valid index from availableFiles and call the tool again."
      };
    }

    const selectedFile = files[selectedIndex];

    console.log(`${LOG_PREFIX} Attachment selected successfully.`, {
      selectedIndex,
      name: selectedFile.name,
      size: selectedFile.size ?? null,
      type: selectedFile.type ?? null
    });

    // Persist original file objects using BeaconBar shared data.
    console.log(`${LOG_PREFIX} Saving all original attachments to shared data...`);

    await BeaconBar.setSharedData(FILES_KEY, files);

    console.log(`${LOG_PREFIX} All attachments saved successfully.`, {
      key: FILES_KEY,
      count: files.length
    });

    console.log(`${LOG_PREFIX} Saving selected attachment to shared data...`);

    await BeaconBar.setSharedData(SELECTED_KEY, selectedFile);

    console.log(`${LOG_PREFIX} Selected attachment saved successfully.`, {
      key: SELECTED_KEY,
      name: selectedFile.name
    });

    console.log(`${LOG_PREFIX} Attachment detection completed successfully.`, {
      filesDetected: files.length,
      selectedIndex,
      selectedFile: selectedFile.name
    });

    return {
      success: true,
      fileDetected: true,
      helperAvailable: true,
      filesDetected: files.length,
      selectedIndex,
      selectedFile: {
        name: selectedFile.name,
        size: selectedFile.size ?? null,
        type: selectedFile.type ?? null
      },
      sharedDataKeys: {
        files: FILES_KEY,
        selectedFile: SELECTED_KEY
      },
      message: `Detected ${files.length} chat attachment(s). Selected the latest file, "${selectedFile.name}", and saved the original file object in shared data under "${SELECTED_KEY}". Use the stored attachment in the application workflow; do not ask the user to upload it again unless it is reported as unavailable or unreadable.`
    };

  } catch (error) {
    console.error(`${LOG_PREFIX} Attachment detection or storage failed:`, {
      error: String(error?.message || error),
      stack: error?.stack || null
    });

    return {
      success: false,
      fileDetected: false,
      error: String(error?.message || error),
      message: "The attachment check or storage operation failed. Do not claim that the file was collected or saved. Continue non-file conversations normally; if a file is required, explain that it could not be accessed."
    };
  }
})