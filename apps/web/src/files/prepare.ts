import { MAX_UPLOAD_BYTES } from '@govserve/shared';

const MAX_DIMENSION = 2000;
const COMPRESS_ABOVE_BYTES = 1024 * 1024;

export interface PreparedFile {
  blob: Blob;
  name: string;
  mime: 'application/pdf' | 'image/jpeg' | 'image/png';
  sha256: string;
}

export class FileProblem extends Error {}

/**
 * Gets a file ready to upload (FR-036): large or very big photos are shrunk to a JPEG in the
 * browser to save data on slow connections; PDFs are sent unchanged. Returns the SHA-256 the
 * server checks after upload.
 */
export async function prepareFile(file: File, allowed: readonly string[]): Promise<PreparedFile> {
  let blob: Blob = file;
  let mime = file.type as PreparedFile['mime'];
  let name = file.name;

  if (
    (mime === 'image/jpeg' || mime === 'image/png') &&
    allowed.includes('image/jpeg') &&
    file.size > COMPRESS_ABOVE_BYTES
  ) {
    const compressed = await compressImage(file);
    if (compressed && compressed.size < file.size) {
      blob = compressed;
      mime = 'image/jpeg';
      name = name.replace(/\.[^.]+$/, '') + '.jpg';
    }
  }
  if (!allowed.includes(mime)) throw new FileProblem('wrongType');
  if (blob.size > MAX_UPLOAD_BYTES) throw new FileProblem('tooLarge');
  return { blob, name, mime, sha256: await sha256Hex(blob) };
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function compressImage(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  } catch {
    // Unsupported in this browser: upload the original if it is small enough.
    return null;
  }
}

/** PUTs to the pre-signed URL with progress (fetch cannot report upload progress). */
export function putWithProgress(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(body);
  });
}
