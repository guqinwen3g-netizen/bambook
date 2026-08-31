import React, { useCallback, useRef, useState } from 'react';
import { ProductImage } from '../types';
import { apiService } from '../services/apiService';
import {
  Upload, X, Star, GripVertical, Image as ImageIcon, Loader2,
} from 'lucide-react';

interface ImageUploaderProps {
  productId: string;
  images: ProductImage[];
  cloudEndpoint?: string;
  isDarkMode?: boolean;
  onChange: (images: ProductImage[]) => void;
}

export default function ImageUploader({
  productId,
  images,
  cloudEndpoint,
  isDarkMode = true,
  onChange,
}: ImageUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const resolveUrl = (img: ProductImage): string => {
    if (img.url) return img.url;
    return apiService.getProductImageUrl(img.filePath);
  };

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f =>
      /^image\/(jpeg|png|webp|gif)$/.test(f.type),
    );
    if (imageFiles.length === 0) return;

    setUploading(true);
    try {
      const newImages = await apiService.uploadProductImages(
        productId,
        imageFiles,
        cloudEndpoint,
      );
      onChange([...images, ...newImages]);
    } catch (err) {
      console.error('[ImageUploader] upload failed:', err);
    } finally {
      setUploading(false);
    }
  }, [productId, images, cloudEndpoint, onChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleDelete = async (imageId: string) => {
    try {
      await apiService.deleteProductImage(productId, imageId, cloudEndpoint);
      onChange(images.filter(img => img.id !== imageId));
    } catch (err) {
      console.error('[ImageUploader] delete failed:', err);
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    try {
      await apiService.setProductImagePrimary(productId, imageId, cloudEndpoint);
      onChange(images.map(img => ({
        ...img,
        isPrimary: img.id === imageId,
      })));
    } catch (err) {
      console.error('[ImageUploader] set primary failed:', err);
    }
  };

  const handleReorder = async (fromIndex: number, toIndex: number) => {
    const reordered = [...images];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const orders = reordered.map((img, i) => ({ id: img.id, sortOrder: i }));
    onChange(reordered.map((img, i) => ({ ...img, sortOrder: i })));
    try {
      await apiService.reorderProductImages(productId, orders, cloudEndpoint);
    } catch (err) {
      console.error('[ImageUploader] reorder failed:', err);
    }
  };

  const moveUp = (index: number) => {
    if (index > 0) handleReorder(index, index - 1);
  };
  const moveDown = (index: number) => {
    if (index < images.length - 1) handleReorder(index, index + 1);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const glassCard = 'bg-[var(--recessed-bg)] border-[var(--border-c-default)]';
  const hoverGlass = 'hover:bg-[var(--recessed-bg-hover)]';

  return (
    <div className="space-y-3">
      {/* Upload zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`
          relative cursor-pointer rounded-inset border-2 border-dashed
          transition-colors duration-200 py-6 px-4 text-center
          ${dragOver
            ? 'border-[var(--os-vnext-brand-blue-soft)]/60 bg-[var(--os-vnext-brand-blue-soft)]/10'
            : 'border-[var(--border-c-default)] hover:border-[var(--border-c-strong)] hover:bg-[var(--hover-darken)]'
          }
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={e => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={24} className="animate-spin text-[var(--os-vnext-brand-blue-soft)]" />
            <span className="text-sm text-[var(--text-tertiary)]">上传中...</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload size={24} className="text-[var(--text-tertiary)]" />
            <span className="text-sm font-light text-[var(--text-tertiary)]">
              拖拽图片到此处，或点击上传
            </span>
            <span className="text-[10px] text-[var(--text-tertiary)]">
              支持 JPEG / PNG / WebP / GIF，单张最大 10MB
            </span>
          </div>
        )}
      </div>

      {/* Image grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img, idx) => (
            <div
              key={img.id}
              className={`
                relative group rounded-inset overflow-hidden border
                transition-colors duration-200
                ${img.isPrimary
                  ? 'border-[var(--os-vnext-brand-blue-soft)]/50 ring-1 ring-[var(--os-vnext-brand-blue-soft)]/30'
                  : 'border-[var(--border-c-default)]'
                }
              `}
            >
              {/* Thumbnail */}
              <div
                className="aspect-square cursor-pointer overflow-hidden"
                onClick={() => setPreviewUrl(resolveUrl(img))}
              >
                <img
                  src={resolveUrl(img)}
                  alt={img.fileName}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  loading="lazy"
                />
              </div>

              {/* Primary badge */}
              {img.isPrimary && (
                <div className={`absolute top-1.5 left-1.5 px-2 py-0.5 rounded-full text-[8px] font-light tracking-wide bg-[var(--os-vnext-brand-blue)] text-[var(--on-accent)]`}>
                  主图
                </div>
              )}

              {/* Actions overlay */}
              <div className={`
                absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150
                flex items-end justify-center pb-1.5 gap-1
                bg-gradient-to-t from-black/30 via-transparent to-transparent
              `}>
                {/* Set primary */}
                {!img.isPrimary && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSetPrimary(img.id); }}
                    className="p-1.5 rounded-control transition-colors bg-[var(--recessed-bg-strong)] hover:bg-[var(--active-darken)] text-[var(--text-primary)]"
                    title="设为主图"
                  >
                    <Star size={14} />
                  </button>
                )}

                {/* Move up */}
                {idx > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); moveUp(idx); }}
                    className="p-1.5 rounded-control transition-colors bg-[var(--recessed-bg-strong)] hover:bg-[var(--active-darken)] text-[var(--text-primary)]"
                    title="上移"
                  >
                    <GripVertical size={14} className="rotate-90" />
                  </button>
                )}

                {/* Delete */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(img.id); }}
                  className="p-1.5 rounded-control transition-colors bg-[var(--recessed-bg)] hover:bg-[var(--active-darken)] text-[var(--text-tertiary)]"
                  title="删除"
                >
                  <X size={14} />
                </button>
              </div>

              {/* File info */}
              <div className="px-1.5 py-1 text-[9px] truncate text-[var(--text-tertiary)] bg-[var(--recessed-bg)]">
                {formatSize(img.fileSize)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {images.length === 0 && !uploading && (
        <div className={`flex flex-col items-center justify-center py-8 rounded-inset border ${glassCard}`}>
          <ImageIcon size={24} className="text-[var(--text-tertiary)]" />
          <span className="mt-2 text-xs text-[var(--text-tertiary)]">
            暂无图片
          </span>
        </div>
      )}

      {/* Full-size preview modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--mask-bg)]"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-inset shadow-none"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setPreviewUrl(null)}
            className="absolute top-6 right-6 p-3 rounded-full bg-[var(--recessed-bg-strong)] hover:bg-[var(--active-darken)] text-[var(--invert-text)] transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
