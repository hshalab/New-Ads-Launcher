"use client"
/* eslint-disable @next/next/no-img-element */

import { useRef, useState, useEffect } from "react"
import { IconPhoto, IconVideo, IconLoader2, IconBrandGoogleDrive } from "@tabler/icons-react"
import { isMetaCdnUrl } from "@/lib/creative-media"

interface Creative {
  id: string
  file_name: string
  file_url: string
  media_type: "image" | "video"
  fb_image_url?: string
  fb_thumbnail_url?: string
  fb_video_id?: string
  status?: "pending" | "processing" | "ready" | "error"
}

// Session-lived caches — survive remounts when navigating Assets/Portal/Vault.
const posterCache = new Map<string, string>()
const failedImageCache = new Set<string>()
const captureInFlight = new Set<string>()

// Capture a JPEG frame from a video URL via Canvas API (client-side, no Meta API call).
// Uses a hidden <video crossOrigin="anonymous"> so canvas.toBlob() is not tainted.
// Silently fails if Supabase Storage hasn't configured CORS for the app origin.
async function captureFrameFromUrl(videoUrl: string, creativeId: string): Promise<string | null> {
  return new Promise((resolve) => {
    const tmp = document.createElement("video")
    tmp.crossOrigin = "anonymous"
    tmp.muted = true
    tmp.playsInline = true
    // #t=1 seeks to 1 second before decoding — avoids black frames at t=0
    tmp.src = videoUrl.split("#")[0] + "#t=1"

    const cleanup = () => {
      tmp.onloadeddata = null
      tmp.onerror = null
      tmp.src = ""
      tmp.load()
    }

    const timer = setTimeout(() => { cleanup(); resolve(null) }, 20000)

    tmp.onerror = () => { clearTimeout(timer); cleanup(); resolve(null) }

    tmp.onloadeddata = () => {
      clearTimeout(timer)
      try {
        const canvas = document.createElement("canvas")
        canvas.width = Math.min(tmp.videoWidth || 1280, 1280)
        canvas.height = Math.min(tmp.videoHeight || 720, 720)
        canvas.getContext("2d")?.drawImage(tmp, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(async (blob) => {
          cleanup()
          if (!blob) { resolve(null); return }
          // Show immediately via object URL
          const objectUrl = URL.createObjectURL(blob)
          // Save to server in the background (non-blocking)
          fetch(`/api/creatives/${creativeId}/save-thumbnail`, {
            method: "POST",
            headers: { "Content-Type": "image/jpeg" },
            body: blob,
          }).catch(() => {})
          resolve(objectUrl)
        }, "image/jpeg", 0.85)
      } catch {
        // SecurityError: canvas tainted (CORS not configured on storage)
        cleanup()
        resolve(null)
      }
    }
  })
}

export function CreativeCardMedia({ creative, className = "h-full w-full object-cover", compact = false, eager = false }: { creative: Creative, className?: string, compact?: boolean, eager?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [imgFailed, setImgFailed] = useState(() => failedImageCache.has(creative.id))
  const [capturedPoster, setCapturedPoster] = useState<string | null>(() => posterCache.get(creative.id) ?? null)
  const captureStartedRef = useRef(false)

  const isVideo = creative.media_type === "video"
  const isPendingVideo = isVideo && creative.status === "pending" && !creative.fb_video_id && !creative.file_url
  const isCreativeMediaRoute = (url: string) => url.startsWith("/api/creatives/")
  const isCreativeThumbnailRoute = (url: string) => isCreativeMediaRoute(url) && url.includes("variant=thumbnail")
  const isDisplayableImageUrl = (url: string) => /^https?:/.test(url) || isCreativeMediaRoute(url)

  const isVideoFile = (url: string) => {
    const ext = [".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"]
    return ext.some(e => url.toLowerCase().includes(e)) || url.startsWith("blob:") || url.includes("fbcdn.net")
  }
  const isSupabaseStorageUrl = (url: string) => url.includes("/storage/v1/object/public/")

  const videoSrc = isPendingVideo ? "" : (creative.file_url || "")
  const isGDrive = videoSrc.includes("#gdrive")
  const cleanVideoSrc = videoSrc.replace("#gdrive", "")
  const stableImageUrl =
    creative.file_url && isDisplayableImageUrl(cleanVideoSrc) && !isVideoFile(cleanVideoSrc) && !isMetaCdnUrl(cleanVideoSrc)
      ? cleanVideoSrc
      : null

  const metaThumb = stableImageUrl
    || ((creative.fb_thumbnail_url && isDisplayableImageUrl(creative.fb_thumbnail_url) && !creative.fb_thumbnail_url.includes("rsrc.php") && !isMetaCdnUrl(creative.fb_thumbnail_url))
      ? creative.fb_thumbnail_url
      : (creative.fb_image_url && isDisplayableImageUrl(creative.fb_image_url) && !isMetaCdnUrl(creative.fb_image_url))
        ? creative.fb_image_url
        : (creative.file_url && isDisplayableImageUrl(creative.file_url) && !isVideoFile(creative.file_url) && !isMetaCdnUrl(creative.file_url))
          ? creative.file_url
          : null)

  // A poster can be a stable image URL or the thumbnail resolver route.
  // Do not use the source resolver route as poster; it returns video bytes.
  const hasRealPoster = metaThumb ? !metaThumb.startsWith("/api/creatives/") || isCreativeThumbnailRoute(metaThumb) : false
  const effectivePoster = capturedPoster || (hasRealPoster ? metaThumb : null)

  const playable = !isPendingVideo && !!(cleanVideoSrc && (/^(blob|data|https?):/.test(cleanVideoSrc) || cleanVideoSrc.startsWith("/")) && (isVideoFile(cleanVideoSrc) || isVideo))

  // Hydrate from session cache when creative id changes (list remount / revisit).
  useEffect(() => {
    const cached = posterCache.get(creative.id)
    if (cached && cached !== capturedPoster) setCapturedPoster(cached)
    if (failedImageCache.has(creative.id)) setImgFailed(true)
    captureStartedRef.current = posterCache.has(creative.id) || captureInFlight.has(creative.id)
  }, [creative.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger client-side canvas capture when video is playable but has no real cached thumbnail.
  useEffect(() => {
    if (!isVideo || !playable || hasRealPoster || capturedPoster || captureStartedRef.current) return
    if (!cleanVideoSrc || (!cleanVideoSrc.startsWith("https://") && !isCreativeMediaRoute(cleanVideoSrc))) return
    if (isSupabaseStorageUrl(cleanVideoSrc)) return
    if (posterCache.has(creative.id)) {
      setCapturedPoster(posterCache.get(creative.id)!)
      return
    }
    if (captureInFlight.has(creative.id)) return
    captureStartedRef.current = true
    captureInFlight.add(creative.id)

    let cancelled = false
    captureFrameFromUrl(cleanVideoSrc, creative.id).then((url) => {
      captureInFlight.delete(creative.id)
      if (!url) return
      posterCache.set(creative.id, url)
      if (!cancelled) setCapturedPoster(url)
    })

    return () => { cancelled = true }
  }, [isVideo, playable, hasRealPoster, capturedPoster, cleanVideoSrc, creative.id])

  // Blob URLs live in posterCache for the session — do not revoke on unmount.

  if (!isVideo) {
    const imgSrc = stableImageUrl || creative.fb_image_url || creative.fb_thumbnail_url || cleanVideoSrc
    return (
      <div className="relative h-full w-full">
        {imgSrc && !imgFailed ? (
          <img src={imgSrc} alt={creative.file_name} className={className} loading={eager ? "eager" : "lazy"} onError={() => { failedImageCache.add(creative.id); setImgFailed(true) }} />
        ) : (
          <div className={`${className} flex items-center justify-center bg-muted`}>
            <IconPhoto className="size-6 text-muted-foreground/40" />
          </div>
        )}
        {isGDrive && (
          <div className="absolute bottom-1.5 right-1.5 rounded bg-white p-0.5 shadow-sm">
            <IconBrandGoogleDrive className="size-3.5 text-[#4285F4]" />
          </div>
        )}
      </div>
    )
  }

  if (playable) {
    if (compact) {
      return (
        <div className="relative h-full w-full bg-muted/30">
          <video
            ref={videoRef}
            src={cleanVideoSrc + (cleanVideoSrc.includes("#t=") ? "" : "#t=0.1")}
            muted
            playsInline
            loop
            preload="metadata"
            poster={effectivePoster || undefined}
            className={className}
            onMouseEnter={e => {
              const v = e.currentTarget
              if (v.preload !== "auto") v.preload = "auto"
              v.play().catch(() => {})
            }}
            onMouseLeave={e => {
              const v = e.currentTarget
              v.pause()
            }}
          />
          {isGDrive && (
            <div className="absolute bottom-1 right-1 rounded bg-white/90 p-0.5 shadow-sm">
              <IconBrandGoogleDrive className="size-3 text-[#4285F4]" />
            </div>
          )}
          {!effectivePoster && !cleanVideoSrc.includes("fbcdn.net") && (
             <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <IconVideo className="size-4 text-muted-foreground/20" />
             </div>
          )}
        </div>
      )
    }
    return (
      <div className="relative h-full w-full bg-muted/30">
        <video
          ref={videoRef}
          src={cleanVideoSrc ? (cleanVideoSrc + (cleanVideoSrc.includes("#t=") ? "" : "#t=0.1")) : undefined}
          muted
          playsInline
          loop
          preload="none"
          poster={effectivePoster || undefined}
          className={className}
          onLoadedData={() => {
            if (videoRef.current) {
              try { videoRef.current.pause() } catch {}
            }
          }}
          onMouseEnter={e => {
            const v = e.currentTarget
            if (v.preload !== "auto") v.preload = "auto"
            v.play().catch(() => {})
          }}
          onMouseLeave={() => {
            if (videoRef.current) {
              videoRef.current.pause()
            }
          }}
        />
        {isGDrive && (
          <div className="absolute bottom-1.5 right-1.5 rounded bg-white/90 p-1 shadow-sm backdrop-blur-sm">
            <IconBrandGoogleDrive className="size-4 text-[#4285F4]" />
          </div>
        )}
        {!effectivePoster && !cleanVideoSrc.includes("fbcdn.net") && (
           <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <IconVideo className="size-6 text-muted-foreground/20" />
           </div>
        )}
      </div>
    )
  }

  if (metaThumb && !imgFailed) {
    return (
      <div className="relative h-full w-full">
        <img src={metaThumb} alt={creative.file_name} className={className} loading={eager ? "eager" : "lazy"} onError={() => { failedImageCache.add(creative.id); setImgFailed(true) }} />
        {isGDrive && (
          <div className="absolute bottom-1.5 right-1.5 rounded bg-white/90 p-1 shadow-sm backdrop-blur-sm">
            <IconBrandGoogleDrive className="size-4 text-[#4285F4]" />
          </div>
        )}
      </div>
    )
  }

  if (isVideo) {
    return (
      <div className={`${className} flex flex-col items-center justify-center gap-1.5 bg-muted`}>
        {creative.fb_video_id || isPendingVideo ? (
          <>
            <IconLoader2 className={`${compact ? "size-3" : "size-5"} text-muted-foreground/40 animate-spin`} />
            {!compact && <span className="text-xs text-muted-foreground/60">{isPendingVideo ? "Uploading video..." : "Generating preview..."}</span>}
          </>
        ) : (
          <IconVideo className={`${compact ? "size-3.5" : "size-6"} text-muted-foreground/40`} />
        )}
      </div>
    )
  }

  return (
    <div className={`${className} flex items-center justify-center bg-muted`}>
      <IconPhoto className={`${compact ? "size-3.5" : "size-6"} text-muted-foreground/40`} />
    </div>
  )
}
