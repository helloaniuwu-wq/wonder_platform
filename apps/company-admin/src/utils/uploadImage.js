/**
 * 上传前图片预处理：EXIF 转正 + 长边缩放 + JPEG 压缩。
 *
 * 背景：iPhone 实拍收据常见 4032×3024 / 2~3MB 且带 EXIF orientation=6。
 * 这种原图直接传给视觉模型会被上游以 415 Unsupported Media Type 拒绝，
 * 触发回退到弱模型，进而写出编造的金额与日期（2026-11-12 故障）。
 * 转正并压缩后约 200~400KB，模型识别稳定，上传也快得多。
 *
 * PDF 一律跳过：它走 OpenRouter 的 file 格式，不能被 canvas 重编码。
 */

const MAX_EDGE = 1600          // 长边像素上限
const MAX_BYTES = 500 * 1024   // 目标体积
const SKIP_BELOW = 200 * 1024  // 小文件且无 EXIF 旋转时跳过，避免无谓重编码
const INITIAL_QUALITY = 0.86

const isPdf = (file) =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

const isImage = (file) =>
  /^image\//i.test(file.type) || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name)

/** 读取 JPEG APP1/Exif 里的 orientation（1 表示无需旋转）。解析失败返回 1。 */
async function readJpegOrientation(file) {
  try {
    const buf = await file.slice(0, 128 * 1024).arrayBuffer()
    const view = new DataView(buf)
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1
    let offset = 2
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset, false)
      if ((marker & 0xff00) !== 0xff00) break
      const length = view.getUint16(offset + 2, false)
      if (length < 2) break
      if (marker === 0xffe1 && offset + 10 < view.byteLength) {
        const magic = String.fromCharCode(...new Uint8Array(buf, offset + 4, 4))
        if (magic === 'Exif') {
          const tiff = offset + 10
          const little = view.getUint16(tiff, false) === 0x4949
          const ifd = tiff + view.getUint32(tiff + 4, little)
          if (ifd + 2 <= view.byteLength) {
            const count = view.getUint16(ifd, little)
            for (let i = 0; i < count; i++) {
              const entry = ifd + 2 + i * 12
              if (entry + 12 > view.byteLength) break
              if (view.getUint16(entry, little) === 0x0112) {
                return view.getUint16(entry + 8, little) || 1
              }
            }
          }
        }
      }
      offset += 2 + length
    }
  } catch { /* 读不到就当没有 EXIF */ }
  return 1
}

/**
 * 解码成已应用 EXIF 方向的位图。
 * createImageBitmap 的 imageOrientation:'from-image' 会让浏览器在解码时转正；
 * 老浏览器走 <img> 路径，现代浏览器同样默认应用 EXIF。
 */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height,
               release: () => bitmap.close?.() }
    } catch { /* 落到 <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight,
             release: () => URL.revokeObjectURL(url) }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })
}

function draw(canvas, decoded, scale) {
  canvas.width = Math.max(1, Math.round(decoded.width * scale))
  canvas.height = Math.max(1, Math.round(decoded.height * scale))
  const ctx = canvas.getContext('2d')
  // JPEG 没有 alpha，先铺白底，避免 PNG 透明区域变黑
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
}

function jpegName(name) {
  const stem = name.replace(/\.[^.]+$/, '')
  return `${stem}.jpg`
}

/** 单文件优化。任何异常都回退成原文件，绝不让上传流程中断。 */
export async function optimizeImage(file) {
  if (!(file instanceof File) || !isImage(file) || isPdf(file)) return file

  const orientation = await readJpegOrientation(file)
  const needsRotation = orientation > 1
  if (!needsRotation && file.size <= SKIP_BELOW) return file

  let decoded
  try {
    decoded = await decodeImage(file)
    if (!decoded.width || !decoded.height) throw new Error('空白图像')

    const canvas = document.createElement('canvas')
    let scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height))
    draw(canvas, decoded, scale)

    let quality = INITIAL_QUALITY
    let blob = await canvasToBlob(canvas, quality)
    while (blob && blob.size > MAX_BYTES && quality > 0.62) {
      quality = Math.max(0.6, quality - 0.1)
      blob = await canvasToBlob(canvas, quality)
    }
    // 降质量仍超标时再缩一档尺寸
    if (blob && blob.size > MAX_BYTES) {
      scale *= 0.75
      draw(canvas, decoded, scale)
      blob = await canvasToBlob(canvas, 0.82)
    }
    if (!blob) throw new Error('canvas 输出为空')
    // 压缩结果反而更大就保留原文件
    if (blob.size >= file.size) return file

    const out = new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: Date.now() })
    console.info(
      `[上传预处理] ${file.name}: ${(file.size / 1024).toFixed(0)}KB → ${(out.size / 1024).toFixed(0)}KB, ` +
      `${decoded.width}×${decoded.height} → ${canvas.width}×${canvas.height}, EXIF=${orientation}`
    )
    return out
  } catch (err) {
    console.warn(`[上传预处理] ${file.name} 跳过优化，使用原文件:`, err?.message || err)
    return file
  } finally {
    decoded?.release?.()
  }
}

/** 批量：expensesApi.upload 用（多文件数组）。 */
export function prepareUploadFiles(files) {
  return Promise.all(Array.from(files || []).map(optimizeImage))
}

/** 已组装好的 FormData：commissionsApi.upload / uploadIR56M 用，替换其中的 File 字段。 */
export async function optimizeFormData(formData) {
  const entries = Array.from(formData.entries())
  if (!entries.some(([, v]) => v instanceof File)) return formData
  const out = new FormData()
  for (const [key, value] of entries) {
    out.append(key, value instanceof File ? await optimizeImage(value) : value)
  }
  return out
}
