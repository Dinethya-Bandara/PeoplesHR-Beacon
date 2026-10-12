# collectChatAttachment

**Task:** collectChatAttachment

**Status:** live

## Description

If the user wants to change, replace, or update a previously uploaded file, or add new files without replacing the existing ones, check the chat for the newly uploaded attachment(s) and call the collectChatAttachment tool to retrieve them. Do not ask the user to upload a file again if it is already available in the chat.

## Signature

```
collectChatAttachment
```

## Arguments

- `fileSelection` (integer, required) — Use the document number from the existing conversation context. Do not ask the user to provide it again, as the entire conversation history is available. For the initial document, use DocumentNo 0.


## Advanced arguments

_None._

