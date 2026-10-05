// 证件照片只需留档可辨，不需要原图分辨率。统一压缩到适合存档的尺寸后再落库，
// 避免几张高清原图撑爆 localStorage。
import { formatBytes } from './storage.js'

const MAX_DIMENSION = 1600 // 长边 1600px，证件内容足够清晰
const FILE_BUDGET = 450 * 1024 // 单张照片控制在 450KB 以内（约占总配额 9%）
const KEEP_ORIGINAL_UNDER = 150 * 1024 // 原本就很小的图不做二次压缩
const STEP_MAX = 3200 // 超大原图先降到该尺寸再做方向处理，避开 canvas 尺寸/内存上限

export class ImageCompressError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ImageCompressError'
  }
}

const QUALITY_STEPS = [0.85, 0.72, 0.6]

// 读取 JPEG 的 EXIF 方向（1–8）。手机拍照常带方向标记，直接丢给 canvas 不处理
// 会得到倒置/镜像的证件照。拿不到就按 1（正常方向）处理。
export function getOrientation(file) {
  return new Promise((resolve) => {
    if (!file.type.includes('jpeg') && !/\.jpe?g$/i.test(file.name)) return resolve(1)
    const reader = new FileReader()
    reader.onerror = () => resolve(1)
    reader.onload = () => {
      try {
        const view = new DataView(reader.result)
        if (view.getUint16(0, false) !== 0xffd8) return resolve(1)
        const length = view.byteLength
        // 段布局：marker(2，位于 offset) + 长度(2) + 数据(从 offset+4 开始)
        let offset = 2
        while (offset + 4 <= length) {
          const marker = view.getUint16(offset, false)
          if (marker === 0xda) return resolve(1) // 到图像数据还没遇到 EXIF
          const segLen = view.getUint16(offset + 2, false)
          if (segLen < 2 || offset + 2 + segLen > length) return resolve(1)
          const dataStart = offset + 4
          if (marker === 0xffe1 && view.getUint32(dataStart, false) === 0x45786966) {
            // "Exif\0\0" 之后才是 TIFF 头：字节序(2)+魔数(2)+IFD偏移(4)
            const tiffStart = dataStart + 6
            const little = view.getUint16(tiffStart, false) === 0x4949
            let ifd = tiffStart + view.getUint32(tiffStart + 4, little)
            const count = view.getUint16(ifd, little)
            ifd += 2
            for (let i = 0; i < count; i += 1) {
              if (view.getUint16(ifd + 12 * i, little) === 0x0112) {
                return resolve(view.getUint16(ifd + 12 * i + 8, little))
              }
            }
            return resolve(1)
          }
          offset += 2 + segLen
        }
      } catch { /* 解析失败按正常方向处理 */ }
      resolve(1)
    }
    // 只读文件头即可，省内存
    reader.readAsArrayBuffer(file.slice(0, Math.min(file.size, 256 * 1024)))
  })
}

const loadImage = (url) => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new ImageCompressError('图片无法解码，请确认文件没有损坏'))
  image.src = url
})

// 按 EXIF 方向把已有（小尺寸）源图画到转正后的 canvas 上，只执行一次方向变换。
function orientCanvas(source, orientation, sourceWidth, sourceHeight) {
  const swap = orientation >= 5 && orientation <= 8
  const canvas = document.createElement('canvas')
  canvas.width = swap ? sourceHeight : sourceWidth
  canvas.height = swap ? sourceWidth : sourceHeight
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // transform 参数: [水平缩放, 垂直倾斜, 水平倾斜, 垂直缩放, 水平位移, 垂直位移]
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, sourceWidth, 0); break
    case 3: ctx.transform(-1, 0, 0, -1, sourceWidth, sourceHeight); break
    case 4: ctx.transform(1, 0, 0, -1, 0, sourceHeight); break
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break
    case 6: ctx.transform(0, 1, -1, 0, sourceHeight, 0); break
    case 7: ctx.transform(0, -1, -1, 0, sourceHeight, sourceWidth); break
    case 8: ctx.transform(0, -1, 1, 0, 0, sourceWidth); break
    default: break
  }
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight)
  return canvas
}

// 先在不转正的情况下逐步降采样，把超大原图压到安全尺寸后再应用一次 EXIF 方向，
// 避免在 4000px 级原图上直接建全尺寸 canvas（可能触及 canvas 尺寸/内存上限）。
function downscale(image, orientation) {
  // 第一步：不考虑方向，先把超大原图降到安全尺寸
  let canvas
  if (Math.max(image.naturalWidth, image.naturalHeight) > STEP_MAX) {
    const scale = STEP_MAX / Math.max(image.naturalWidth, image.naturalHeight)
    canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  } else {
    canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    canvas.getContext('2d').drawImage(image, 0, 0)
  }
  // 第二步：在小尺寸源图上应用 EXIF 方向（5–8 会宽高互换）
  canvas = orientCanvas(canvas, orientation, canvas.width, canvas.height)
  // 第三步：继续缩到存档尺寸
  while (Math.max(canvas.width, canvas.height) > MAX_DIMENSION * 2) {
    const next = document.createElement('canvas')
    next.width = Math.max(1, Math.round(canvas.width / 2))
    next.height = Math.max(1, Math.round(canvas.height / 2))
    next.getContext('2d').drawImage(canvas, 0, 0, next.width, next.height)
    canvas = next
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(canvas.width, canvas.height))
  if (scale < 1) {
    const next = document.createElement('canvas')
    next.width = Math.max(1, Math.round(canvas.width * scale))
    next.height = Math.max(1, Math.round(canvas.height * scale))
    next.getContext('2d').drawImage(canvas, 0, 0, next.width, next.height)
    canvas = next
  }
  return canvas
}

const dataUrlBytes = (dataUrl) => {
  const comma = dataUrl.indexOf(',')
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  return Math.floor(base64.length * 3 / 4)
}

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = () => reject(new ImageCompressError('文件读取失败，请重试'))
  reader.readAsDataURL(file)
})

/**
 * 压缩证件照片，返回 dataURL 与大小信息。
 * @returns {Promise<{dataUrl:string, bytes:number, width:number, height:number, compressed:boolean}>}
 */
export async function compressIdPhoto(file) {
  if (!file.type.startsWith('image/')) {
    throw new ImageCompressError('仅支持图片文件（JPG、PNG 等）')
  }
  // 已经很小的图保持原样，压缩反而可能把文件弄大或造成可察觉损失。
  if (file.size <= KEEP_ORIGINAL_UNDER) {
    const dataUrl = await readAsDataUrl(file)
    return { dataUrl, bytes: file.size, compressed: false, keptOriginal: true }
  }

  const orientation = await getOrientation(file)
  const objectUrl = URL.createObjectURL(file)
  let image
  try {
    image = await loadImage(objectUrl)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }

  let canvas = downscale(image, orientation)

  // 先调质量；质量压到底仍超预算，再继续缩小尺寸。
  let dataUrl = ''
  for (const quality of QUALITY_STEPS) {
    dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (dataUrlBytes(dataUrl) <= FILE_BUDGET) break
  }
  let bytes = dataUrlBytes(dataUrl)
  if (bytes > FILE_BUDGET) {
    let dimensionScale = 0.75
    while (bytes > FILE_BUDGET && dimensionScale > 0.3) {
      const next = document.createElement('canvas')
      next.width = Math.max(1, Math.round(canvas.width * dimensionScale))
      next.height = Math.max(1, Math.round(canvas.height * dimensionScale))
      next.getContext('2d').drawImage(canvas, 0, 0, next.width, next.height)
      dataUrl = next.toDataURL('image/jpeg', 0.6)
      bytes = dataUrlBytes(dataUrl)
      canvas = next
      dimensionScale -= 0.15
    }
  }

  return { dataUrl, bytes, width: canvas.width, height: canvas.height, compressed: true }
}

export const photoSizeLabel = (bytes) => formatBytes(bytes)
export const PHOTO_BUDGET = FILE_BUDGET
