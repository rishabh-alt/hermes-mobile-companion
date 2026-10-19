import { useState } from "react";
import { Download, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
}

export function ImageLightbox({ open, onOpenChange, src, alt }: Props) {
  const [zoom, setZoom] = useState<1 | 2 | 3>(1);

  const cycleZoom = () => {
    setZoom((prev) => (prev === 1 ? 2 : prev === 2 ? 3 : 1));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setZoom(1);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92dvh] max-w-[95vw] gap-3 overflow-hidden rounded-3xl border-border/70 bg-background/95 p-4 backdrop-blur-xl sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-8">
            <DialogTitle className="truncate text-sm font-medium">
              {alt || "Image preview"}
            </DialogTitle>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                onClick={cycleZoom}
                aria-label="Toggle zoom"
              >
                {zoom > 1 ? (
                  <ZoomOut className="h-3.5 w-3.5" />
                ) : (
                  <ZoomIn className="h-3.5 w-3.5" />
                )}
                {zoom}x
              </Button>
              <Button asChild size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs">
                <a href={src} download={alt || "hermes-image.png"}>
                  <Download className="h-3.5 w-3.5" />
                  Save
                </a>
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div
          className={
            zoom > 1
              ? "flex max-h-[76dvh] items-start justify-start overflow-auto rounded-2xl bg-black/50 p-2"
              : "flex max-h-[76dvh] items-center justify-center overflow-auto rounded-2xl bg-black/50 p-2"
          }
        >
          <img
            src={src}
            alt={alt}
            onClick={cycleZoom}
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: zoom > 1 ? "top left" : "center center",
            }}
            className="max-h-[72dvh] max-w-full cursor-zoom-in rounded-lg object-contain transition-transform duration-200"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
