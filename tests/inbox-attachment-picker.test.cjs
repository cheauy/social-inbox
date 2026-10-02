const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loader } = require('./tenh-seven/harness.cjs');

const { DIRECT_ATTACHMENT_ACCEPT, selectAttachments } =
  loader({}, { File })('lib/inbox/attachment-selection.ts');

const file = (name, type, bytes = 1) =>
  new File([new Uint8Array(bytes)], name, { type });

test('one picker accepts one or multiple images, video, audio and supported documents', () => {
  const files = [
    file('one.jpg', 'image/jpeg'),
    file('two.png', 'image/png'),
    file('clip.mp4', 'video/mp4'),
    file('voice.mp3', 'audio/mpeg'),
    file('invoice.pdf', 'application/pdf'),
  ];
  const result = selectAttachments(files);
  assert.deepEqual(Array.from(result.accepted, (item) => item.kind), [
    'image', 'image', 'video', 'audio', 'file',
  ]);
  assert.equal(result.rejected.length, 0);
  assert.match(DIRECT_ATTACHMENT_ACCEPT, /image\/\*/);
  assert.match(DIRECT_ATTACHMENT_ACCEPT, /video\/\*/);
  assert.match(DIRECT_ATTACHMENT_ACCEPT, /\.pdf/);
});

test('cancel is a no-op and choosing the same file again remains possible', () => {
  const cancelled = selectAttachments(null);
  assert.equal(cancelled.accepted.length, 0);
  assert.equal(cancelled.rejected.length, 0);
  const same = file('same.jpg', 'image/jpeg');
  assert.equal(selectAttachments([same]).accepted.length, 1);
  assert.equal(selectAttachments([same]).accepted.length, 1);
});

test('unsupported, oversized and extra videos are rejected with explicit reasons', () => {
  const result = selectAttachments([
    file('script.exe', 'application/octet-stream'),
    file('huge.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1),
    file('first.mp4', 'video/mp4'),
    file('second.mp4', 'video/mp4'),
  ]);
  assert.deepEqual(Array.from(result.accepted, (item) => item.file.name), ['first.mp4']);
  assert.match(result.rejected[0].reason, /unsupported/);
  assert.match(result.rejected[1].reason, /10 MB/);
  assert.match(result.rejected[2].reason, /one video/);
  assert.equal(selectAttachments([file('clip.mp4', 'video/mp4')], {
    existingVideoCount: 1,
  }).accepted.length, 0);
});

test('Telegram channel limits are applied before staging', () => {
  const result = selectAttachments([
    file('large.jpg', 'image/jpeg', 4 * 1024 * 1024 + 1),
    file('clip.mov', 'video/quicktime'),
    file('clip.mp4', 'video/mp4'),
  ], { platform: 'telegram' });
  assert.deepEqual(Array.from(result.accepted, (item) => item.file.name), ['clip.mp4']);
  assert.match(result.rejected[0].reason, /4 MB/);
  assert.match(result.rejected[1].reason, /MP4/);
});

test('composer exposes direct device files and Storage without auto-sending selected files', () => {
  const source = fs.readFileSync('components/inbox/reply-box.tsx', 'utf8');
  assert.match(source, /accept=\{DIRECT_ATTACHMENT_ACCEPT\}[\s\S]*?multiple[\s\S]*?onChange=\{handleAttachmentChange\}/);
  assert.match(source, /"Image & Video & File"/);
  assert.match(source, /"Select files directly from your device"/);
  assert.match(source, /"Storage"/);
  assert.match(source, /"Select from storage"/);
  assert.doesNotMatch(source, /"Add images"|"Add video"|"Add files"/);
  assert.match(source, /<WorkspaceStorageModal[\s\S]*?onSend=\{sendWorkspaceFiles\}[\s\S]*?onDraft=\{draftWorkspaceFiles\}/);
  assert.match(source, /businessId=\{storageBusinessId\}[\s\S]*?memberId=\{storageMemberId\}/);
  assert.match(source, /async function sendWorkspaceFiles/);
  assert.match(source, /async function draftWorkspaceFiles/);
  assert.doesNotMatch(source, /<CustomerFilesModal/);
  assert.match(source, /event\.target\.value = ""/);
});

test('Storage is workspace-shared, uploads multiple files, and offers explicit Draft or Send Now actions', () => {
  const modal = fs.readFileSync('components/inbox/workspace-storage-modal.tsx', 'utf8');
  assert.match(modal, /\/api\/workspace-storage\/files/);
  assert.match(modal, /action: "prepare-upload"/);
  assert.match(modal, /\.uploadToSignedUrl\(/);
  assert.match(modal, /action: "finalize-upload"/);
  assert.match(modal, /action: "get-file-url"/);
  assert.match(modal, /multiple/);
  assert.match(modal, /applySelectedFiles\("draft"\)/);
  assert.match(modal, /applySelectedFiles\("send"\)/);
  assert.match(modal, /"Draft"/);
  assert.match(modal, /"Send Now"/);
  assert.doesNotMatch(modal, /customer_files|contactId|conversationId/);
  assert.match(modal, /workspaceFilesForView\(files, view\)/);
  assert.match(modal, /readWorkspaceStorageCache\(cacheKey\)/);
  assert.match(modal, /refreshWorkspaceStorageCache\(cacheKey/);
  assert.match(modal, /setSelected\(failed\)/);
  assert.doesNotMatch(modal, /localStorage|sessionStorage/);
  assert.match(modal, /grid-cols-2 gap-2 min-\[390px\]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5/);
  assert.match(modal, /group-hover:opacity-100/);
  assert.match(modal, /aria-label=\{`Preview \$\{file\.name\}`\}/);
  assert.match(modal, /action: "delete-files"/);
  assert.match(modal, /Files in this category are kept and become uncategorised/);
  assert.doesNotMatch(modal, /action: "restore-files"|Trash is empty/);
  assert.match(modal, /cannot be undone/);
  assert.match(modal, /role="alert"/);
  assert.match(modal, /role="status" aria-label="Loading workspace files"/);
  assert.match(modal, /No favorite/);
  assert.match(modal, /event\.stopPropagation\(\); setCategoryForm\(null\)/);
});

test('attachment menu fits narrow viewports and remains keyboard accessible', () => {
  const source = fs.readFileSync('components/inbox/reply-box.tsx', 'utf8');
  assert.match(source, /role="menu"/);
  assert.equal((source.match(/\n\s+role="menuitem"/g) ?? []).length, 3);
  assert.match(source, /w-fit min-w-\[min\(22rem,calc\(100vw-1rem\)\)\] max-w-\[calc\(100vw-1rem\)\]/);
  assert.match(source, /max-h-\[calc\(100dvh-8rem\)\]/);
  assert.match(source, /overflow-x-hidden overflow-y-auto/);
  assert.equal((source.match(/min-h-11/g) ?? []).length, 3);
  assert.equal((source.match(/col-start-2 min-w-0/g) ?? []).length, 3);
  assert.match(source, /\["ArrowDown", "ArrowUp", "Home", "End"\]/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /attachmentTriggerRef\.current\?\.focus\(\)/);
  assert.match(source, /"Image & Video & File"/);
  assert.match(source, /"Select files directly from your device"/);
  assert.match(source, /"Storage"/);
  assert.match(source, /"Select from storage"/);
  assert.match(source, /"Send location"/);
  assert.match(source, /"ភ្ជាប់ដោយផ្ទាល់"/);
  assert.match(source, /"ឃ្លាំងឯកសារ"/);
  assert.match(source, /"ផ្ញើទីតាំង"/);
});
