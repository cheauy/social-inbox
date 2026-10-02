/* eslint-disable @typescript-eslint/no-require-imports */
const React = require("react");

module.exports = {
  createClient: () => ({
    storage: {
      from: () => ({
        uploadToSignedUrl: async () => ({ error: null }),
      }),
    },
  }),
  CustomerTagSelector: () => null,
  SavedReplySelector: () => null,
  LocationPickerDialog: () => null,
  TenhStickerPicker: () => null,
  useOnlineStatus: () => ({ online: true }),
  useWorkspaceLanguageId: () => "en",
  clipboardImageFiles: () => [],
  Fragment: React.Fragment,
};
