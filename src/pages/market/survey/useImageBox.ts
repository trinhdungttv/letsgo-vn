// Đo khung ảnh đang hiện (ảnh object-contain trong khung lớn hơn) để đặt lớp ghi chú khít lên ảnh.
import { useCallback, useEffect, useRef, useState } from 'react';

interface ImgBox { l: number; t: number; w: number; h: number; aspect: number }

export function useImageBox() {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [box, setBox] = useState<ImgBox | null>(null);
  const measure = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    setBox({ l: img.offsetLeft, t: img.offsetTop, w: img.offsetWidth, h: img.offsetHeight, aspect: img.naturalHeight / img.naturalWidth });
  }, []);
  useEffect(() => {
    const img = imgRef.current;
    if (!img || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(img);
    if (img.complete) measure();
    return () => ro.disconnect();
  }, [measure]);
  return { imgRef, box, measure };
}

