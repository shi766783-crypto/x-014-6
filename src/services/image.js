const MAX_LONG_EDGE = 1600
const JPEG_QUALITY = 0.82

function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).catch(() => new Promise((resolve, reject) => {
      const image = new Image()
      const url = URL.createObjectURL(file)
      image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法读取，请更换文件')) }
      image.src = url
    }))
  }

  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法读取，请更换文件')) }
    image.src = url
  })
}

function getSize(image) {
  if ('naturalWidth' in image) return { width: image.naturalWidth, height: image.naturalHeight }
  return { width: image.width, height: image.height }
}

export async function compressDocumentPhoto(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('请选择 JPG、PNG 等图片文件')

  const image = await loadImage(file)
  try {
    const sourceSize = getSize(image)
    if (!sourceSize.width || !sourceSize.height) throw new Error('图片尺寸无效')

    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(sourceSize.width, sourceSize.height))
    const width = Math.max(1, Math.round(sourceSize.width * scale))
    const height = Math.max(1, Math.round(sourceSize.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器不支持图片压缩')

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    if (!dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('图片压缩失败')

    return {
      dataUrl,
      width,
      height,
      bytes: Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 3 / 4),
    }
  } finally {
    if (typeof image.close === 'function') image.close()
  }
}
