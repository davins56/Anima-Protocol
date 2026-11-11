import { downscaleDataUrl } from "@/lib/downscaleImage";
import { readPhotoAsDataUrl } from "@/lib/avatarPhoto";
import { classifyUserContextFile } from "@/lib/userContextUpload";

/**
 * Read a picked image as a downscaled data URL (and a smaller File for
 * storage). Large phone photos (5–15MB) are shrunk to ~1024px JPEG; the
 * original is kept if downscaling fails. The backend reads (OCR + describes)
 * the inline data URL; it has no fetchable copy of the file.
 */
export async function readUserContextImage(file) {
  let fileToUpload = file;
  let imageDataUrl = "";
  try {
    const dataUrl = await readPhotoAsDataUrl(file);
    if (dataUrl) {
      let small = "";
      try {
        small = await downscaleDataUrl(dataUrl, 1024, 0.85);
      } catch (downscaleErr) {
        console.debug("Image downscale failed; using original", downscaleErr);
      }
      imageDataUrl = small || dataUrl;
      if (small) {
        const blob = await (await fetch(small)).blob();
        const baseName = file.name.replace(/\.[^.]+$/, "");
        fileToUpload = new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
      }
    }
  } catch (readErr) {
    console.debug("Image read failed; using original", readErr);
    fileToUpload = file;
  }
  return { fileToUpload, imageDataUrl };
}

/** processUserContext payload for a picked .txt/.md or image file. */
export async function buildUserContextPayload(file, { title, docType, fileUrl = "", imageDataUrl } = {}) {
  const kind = classifyUserContextFile(file);
  if (kind === "image") {
    const dataUrl = imageDataUrl ?? (await readUserContextImage(file)).imageDataUrl;
    return {
      file_url: fileUrl,
      file_content: "",
      is_pdf: false,
      is_image: true,
      image_data_url: dataUrl,
      document_type: docType,
      title,
    };
  }
  const text = await file.text();
  return {
    file_url: fileUrl,
    file_content: text,
    is_pdf: false,
    is_image: false,
    image_data_url: "",
    document_type: docType,
    title,
  };
}

