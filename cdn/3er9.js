import fs from "fs"
import path from "path"
import os from "os"
import { execFile } from "child_process"
import { promisify } from "util"
import { downloadContentFromMessage } from "bail"
import { Image as WebpImage } from "node-webpmux"

const execFileAsync = promisify(execFile)

const PACKNAME = "📍 𝘄ʜɪsɪᴛo"
const AUTHOR = "⊹ 𝗺ᴀᴅᴇ ʙʏ ᴀᴅᴏ"

export default {
  name: ["s", "sticker"],
  alias: ["stik", "stiker"],
  exec: async (sock, m, args) => {
    const from = m.key.remoteJid

    const msg = m.message || {}
    const ctx = (msg.extendedTextMessage && msg.extendedTextMessage.contextInfo) ? msg.extendedTextMessage.contextInfo : null
    const quoted = (ctx && ctx.quotedMessage) ? ctx.quotedMessage : null

    const targetMsg = quoted ? { message: quoted } : m
    const tMsg = targetMsg.message || {}

    const hasImage = !!tMsg.imageMessage
    const hasVideo = !!tMsg.videoMessage
    const hasSticker = !!tMsg.stickerMessage
    const hasDoc = !!tMsg.documentMessage

    if (!hasImage && !hasVideo && !hasSticker && !hasDoc) {
      return await sock.sendMessage(
        from,
        { text: "📍 *_Uso:_* responde a una *imagen / video / gif / webp* con *.s*" },
        { quoted: m }
      )
    }

    let type = hasImage ? "imageMessage" : hasVideo ? "videoMessage" : hasSticker ? "stickerMessage" : "documentMessage"
    let mime = getMime(tMsg, type)

    if (type === "documentMessage") {
      if (!mime) mime = getMime(tMsg, "documentMessage")
      const isDocMedia = /^image\//i.test(mime) || /^video\//i.test(mime)
      if (!isDocMedia) {
        return await sock.sendMessage(
          from,
          { text: "🦞 Responde a una *imagen/video/gif* para crear un sticker." },
          { quoted: m }
        )
      }
    }

    if (!mime) {
      return await sock.sendMessage(from, { text: "📍 *Algo salió mal, no se pudo detectar el tipo de archivo.*" }, { quoted: m })
    }

    const isWebp = /image\/webp/i.test(mime)
    const isImage = /^image\//i.test(mime)
    const isVideo = /^video\//i.test(mime)

    if (!isWebp && !isImage && !isVideo) {
      return await sock.sendMessage(
        from,
        { text: "🦞 Solo puedes responder a una *imagen / video / gif / webp*." },
        { quoted: m }
      )
    }

    let mediaBuffer
    try {
      mediaBuffer = await downloadMediaMessage(targetMsg)
    } catch (e) {
      return await sock.sendMessage(from, { text: `🐢 Error Failed:\n${cut(e.message)}` }, { quoted: m })
    }

    if (!mediaBuffer || !mediaBuffer.length) {
      return await sock.sendMessage(from, { text: "🌾 No se pudo descargar el archivo." }, { quoted: m })
    }

    if (isWebp) {
      try {
        const stamped = await addStickerExif(mediaBuffer, PACKNAME, AUTHOR)
        return await sock.sendMessage(from, { sticker: stamped }, { quoted: m })
      } catch (e) {
        return await sock.sendMessage(from, { sticker: mediaBuffer }, { quoted: m })
      }
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stk-"))
    const inExt = isImage ? guessImageExt(mime) : guessVideoExt(mime)
    const inputPath = path.join(tmpDir, `in.${inExt}`)
    const outputPath = path.join(tmpDir, "out.webp")

    try {
      fs.writeFileSync(inputPath, mediaBuffer)

      if (isImage) {
        await toWebpImage(inputPath, outputPath)
      } else {
        await toWebpVideo(inputPath, outputPath)
      }

      let webp = fs.readFileSync(outputPath)
      try {
        webp = await addStickerExif(webp, PACKNAME, AUTHOR)
      } catch (e) {}

      await sock.sendMessage(from, { sticker: webp }, { quoted: m })
    } catch (e) {
      await sock.sendMessage(from, { text: `📍 Failed with ffmpeg:\n${cut(e.message)}` }, { quoted: m })
    } finally {
      safeRm(tmpDir)
    }
  }
}

function getMime(message, type) {
  try {
    const obj = message[type]
    if (!obj) return ""
    return obj.mimetype || obj.mimeType || ""
  } catch {
    return ""
  }
}

function guessImageExt(mime) {
  if (/png/i.test(mime)) return "png"
  if (/jpe?g/i.test(mime)) return "jpg"
  if (/webp/i.test(mime)) return "webp"
  if (/gif/i.test(mime)) return "gif"
  return "jpg"
}

function guessVideoExt(mime) {
  if (/mp4/i.test(mime)) return "mp4"
  if (/webm/i.test(mime)) return "webm"
  if (/3gpp/i.test(mime)) return "3gp"
  if (/mkv/i.test(mime)) return "mkv"
  return "mp4"
}

async function toWebpImage(input, output) {
  const args = [
    "-y",
    "-i", input,
    "-vf",
    "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba",
    "-vcodec", "libwebp",
    "-lossless", "0",
    "-q:v", "70",
    "-preset", "picture",
    "-an",
    output
  ]
  await runFfmpeg(args)
}

async function toWebpVideo(input, output) {
  const args = [
    "-y",
    "-i", input,
    "-t", "10",
    "-vf",
    "fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba",
    "-vcodec", "libwebp",
    "-q:v", "60",
    "-preset", "default",
    "-loop", "0",
    "-an",
    "-vsync", "0",
    output
  ]
  await runFfmpeg(args)
}

async function runFfmpeg(args) {
  try {
    await execFileAsync("ffmpeg", args, { windowsHide: true })
  } catch (e) {
    const stderr = (e && e.stderr) ? String(e.stderr) : ""
    const msg = stderr || ((e && e.message) ? String(e.message) : "ffmpeg error")
    throw new Error(msg)
  }
}

function safeRm(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true })
  } catch {}
}

function cut(txt, max) {
  if (max == null) max = 3500
  txt = (txt == null) ? "" : String(txt)
  return txt.length > max ? txt.slice(0, max) + "\n..." : txt
}

async function downloadMediaMessage(msgWrap) {
  const m = msgWrap.message || {}

  let type = null
  if (m.imageMessage) type = "image"
  else if (m.videoMessage) type = "video"
  else if (m.stickerMessage) type = "sticker"
  else if (m.documentMessage) type = "document"
  else throw new Error("No media content")

  const content =
    type === "image" ? m.imageMessage :
    type === "video" ? m.videoMessage :
    type === "sticker" ? m.stickerMessage :
    m.documentMessage

  const stream = await downloadContentFromMessage(content, type)
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function buildExif(packname, author) {
  const stickerPackId = "whisito-ado"
  const json = {
    "sticker-pack-id": stickerPackId,
    "sticker-pack-name": String(packname || ""),
    "sticker-pack-publisher": String(author || ""),
    "emojis": ["✨"]
  }

  const exifAttr = Buffer.from([
    0x49,0x49,0x2A,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,0x07,0x00,
    0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00
  ])

  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8")
  const exif = Buffer.concat([exifAttr, jsonBuf])

  exif.writeUIntLE(jsonBuf.length, 14, 4)
  exif.writeUIntLE(exifAttr.length, 18, 4)

  return exif
}

async function addStickerExif(webpBuffer, packname, author) {
  const img = new WebpImage()
  await img.load(webpBuffer)
  img.exif = buildExif(packname, author)
  return await img.save(null)
}
