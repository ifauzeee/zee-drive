export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class LockedError extends HttpError {
  folderId: string;
  folderName: string;
  constructor(folderId: string, folderName: string) {
    super(423, `Folder "${folderName || folderId}" dilindungi kata sandi.`);
    this.folderId = folderId;
    this.folderName = folderName;
  }
}
