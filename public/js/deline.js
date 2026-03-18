// Deline Uploader API
export const uploadDeline = async (file) => {
  const ext = file.name?.split('.').pop() || 'bin';
  const mime = file.type || 'application/octet-stream';
  const buffer = await file.arrayBuffer();

  const fd = new FormData();
  fd.append("file", new Blob([buffer], { type: mime }), `file.${ext}`);

  const res = await fetch("https://api.deline.web.id/uploader", {
    method: "POST",
    body: fd
  });

  const data = await res.json();
  if (data.status === false) throw new Error(data.message || data.error || "Upload gagal");

  const link = data?.result?.link || data?.url || data?.path;
  if (!link) throw new Error("Tidak ada link dari server");
  return link;
};

export const isImage = (url) => /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url);
export const isVideo = (url) => /\.(mp4|webm|mov|avi)(\?|$)/i.test(url);
