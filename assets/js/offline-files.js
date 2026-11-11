/* Local photo conversion: pixels stay in the browser until Submit is pressed. */
(() => {
  'use strict';
  const MAX_BYTES = 40 * 1024 * 1024;
  const isPhoto = f => /^image\/(jpeg|png|webp)$/i.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
  const isPdf = f => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));

  async function photoCanvas(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('This photo is empty.');
      const scale = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas;
    } catch (_) {
      throw new Error(`Could not read ${file.name}. Use a JPG, PNG or WebP photo.`);
    } finally { URL.revokeObjectURL(url); }
  }

  // A small image-only PDF writer: each JPEG is embedded unchanged on an A4
  // page. Byte offsets, stream lengths and xref entries use binary byte counts.
  async function photosToPdf(files, progress = () => {}) {
    if (!files.length || files.length > 25) throw new Error('Choose between 1 and 25 photos.');
    if (files.some(f => !isPhoto(f))) throw new Error('Choose JPG, PNG or WebP photos, or one PDF.');
    if (files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) throw new Error('Choose up to 40 MB of photos.');
    const enc = new TextEncoder(), chunks = [], offsets = [0];
    let length = 0;
    const push = value => { const bytes = typeof value === 'string' ? enc.encode(value) : value; chunks.push(bytes); length += bytes.byteLength; };
    const object = (id, value) => { offsets[id] = length; push(`${id} 0 obj\n${value}\nendobj\n`); };
    push('%PDF-1.4\n');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, `<< /Type /Pages /Count ${files.length} /Kids [${files.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
    for (let i = 0; i < files.length; i++) {
      progress(i + 1, files.length);
      const canvas = await photoCanvas(files[i]);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('Could not convert this photo. Please try a smaller image.');
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      const scale = Math.min(559 / canvas.width, 806 / canvas.height);
      const w = (canvas.width * scale).toFixed(3), h = (canvas.height * scale).toFixed(3);
      const stream = `q ${w} 0 0 ${h} ${((595 - w) / 2).toFixed(3)} ${((842 - h) / 2).toFixed(3)} cm /Photo Do Q\n`;
      const id = 3 + i * 3;
      object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Photo ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
      object(id + 1, `<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}endstream`);
      offsets[id + 2] = length;
      push(`${id + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
      push(jpeg); push('\nendstream\nendobj\n');
      canvas.width = canvas.height = 0;
    }
    const xref = length;
    push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    offsets.slice(1).forEach(n => push(`${String(n).padStart(10, '0')} 00000 n \n`));
    push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const file = new File(chunks, 'answer-script.pdf', { type: 'application/pdf' });
    if (file.size > MAX_BYTES) throw new Error('The converted PDF exceeds 40 MB. Choose smaller photos.');
    return file;
  }

  async function validatePdf(file) {
    if (!isPdf(file)) throw new Error('Choose a PDF file.');
    if (file.size > MAX_BYTES) throw new Error('The PDF must be 40 MB or smaller.');
    const header = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
    if (header !== '%PDF-') throw new Error('This file is not a valid PDF.');
  }
  async function downloadPdf(url, name) {
    const response = await fetch(window.NTCUploadcare ? NTCUploadcare.deliveryUrl(url) : url);
    if (!response.ok) throw new Error('PDF delivery failed (HTTP ' + response.status + '). Please ask your teacher to check the file in Uploadcare.');
    const blob = await response.blob();
    if (new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer()) !== '%PDF-') {
      throw new Error('The file service returned an error page instead of a PDF. Please ask your teacher to check the Uploadcare file link.');
    }
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl; link.download = name.replace(/[^a-z0-9_.-]/gi, '_');
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }
  window.NTCOfflineFiles = { isPhoto, isPdf, photosToPdf, validatePdf, downloadPdf };
})();
