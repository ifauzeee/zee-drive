import { getAccessToken } from "./drive";
import { HttpError } from "./errors";
import type { AppEnv } from "./env";

// Ballpark limit for the Workers free tier (100 MB request body cap) minus
// multipart/form-data overhead, leaving headroom for concurrent large uploads.
export const MAX_UPLOAD_BYTES = 75 * 1024 * 1024;

export type UploadedFile = { id: string; name: string };

export async function uploadToDrive(
  env: AppEnv,
  name: string,
  mimeType: string,
  folderId: string,
  size: number,
  body: BodyInit,
): Promise<UploadedFile> {
  const token = await getAccessToken(env);

  const create = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": mimeType,
        "x-upload-content-length": String(size),
      },
      body: JSON.stringify({ name, parents: [folderId] }),
    },
  );
  if (!create.ok) {
    const detail = await create.text();
    console.error(`Drive reject upload create (${create.status}):`, detail.slice(0, 200));
    throw new HttpError(502, "Gagal mengunggah ke Google Drive.");
  }
  const uploadUrl = create.headers.get("location");
  if (!uploadUrl) throw new HttpError(502, "Google tidak memberikan URL upload.");

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": mimeType, "content-length": String(size) },
    body,
  });
  if (!put.ok) {
    const detail = await put.text();
    console.error(`Drive reject upload put (${put.status}):`, detail.slice(0, 200));
    throw new HttpError(502, "Gagal mengunggah ke Google Drive.");
  }

  const result = (await put.json()) as { id: string; name: string };
  return { id: result.id, name: result.name };
}