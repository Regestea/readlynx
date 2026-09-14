import { useEffect, useRef } from "react";
import { PdfViewer } from "../../../components/pdfViewer/PdfViewer";
import type { PdfCoverJob } from "../hooks/useExternalFileOpen";

/** Give the hidden viewer this long to produce a snapshot before giving
 *  up — the book stays usable without a cover. */
const CAPTURE_TIMEOUT_MS = 45000;

interface PdfCoverCaptureProps {
  job: PdfCoverJob;
  onDone: () => void;
}

/** Renders a PDF's first page fully offscreen and stores the high-res
 *  snapshot (`PdfViewer.onPageSnapshot`) as the book cover. Used after a
 *  silent "Open with" import, where there is no cover dialog. */
export function PdfCoverCapture({ job, onDone }: PdfCoverCaptureProps) {
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    doneRef.current = false;
    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDoneRef.current();
    };
    const timer = window.setTimeout(finish, CAPTURE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [job.key]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        left: -10000,
        top: 0,
        width: 800,
        height: 1000,
        visibility: "hidden",
        pointerEvents: "none",
      }}
    >
      <PdfViewer
        key={job.key}
        filePath={job.storedPath}
        fill
        toolbar={false}
        onPageSnapshot={(snapshot) => {
          if (doneRef.current) return;
          if (!snapshot) return;
          doneRef.current = true;
          void window.readlynx?.db
            .updateBook({ bookId: job.bookId, title: job.title, coverImage: snapshot })
            .catch(() => null)
            .finally(() => onDoneRef.current());
        }}
      />
    </div>
  );
}
