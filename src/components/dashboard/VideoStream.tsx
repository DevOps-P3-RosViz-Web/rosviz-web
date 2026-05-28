'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useROS } from '@/hooks/useROS';

interface VideoStreamProps {
  topic: string;
  robotId: number;
}

interface ROSCompressedImage {
  header: {
    seq: number;
    stamp: { secs: number; nsecs: number };
    frame_id: string;
  };
  format: string;
  data: number[];
}

const VideoStream: React.FC<VideoStreamProps> = ({ topic, robotId }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const [error, setError] = useState<string>('');
  const [hasFrame, setHasFrame] = useState(false);
  const { subscribe, isConnected } = useROS();

  useEffect(() => {
    const compressedTopic = `${topic}/compressed`;

    const processImage = (message: ROSCompressedImage) => {
      try {
        if (!imgRef.current) return;

        const byteArray = new Uint8Array(message.data);
        const blob = new Blob([byteArray], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);

        const img = imgRef.current;
        img.onload = () => {
          if (img.dataset.prevUrl) {
            URL.revokeObjectURL(img.dataset.prevUrl);
          }
          img.dataset.prevUrl = url;
        };

        img.src = url;
        setError('');
        if (!hasFrame) setHasFrame(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    };

    const unsubscribe = subscribe(
      compressedTopic,
      'sensor_msgs/CompressedImage',
      processImage,
      robotId
    );

    return () => {
      unsubscribe();
      if (imgRef.current?.dataset.prevUrl) {
        URL.revokeObjectURL(imgRef.current.dataset.prevUrl);
      }
    };
  }, [topic, robotId, subscribe]);

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
      <img
        ref={imgRef}
        className="w-full h-full object-contain"
        style={{ 
          imageRendering: '-webkit-optimize-contrast',
          backgroundColor: 'black'
        }}
        alt="Camera Feed"
        onError={() => setError('Failed to load image')}
      />
      {error && (
        <div className="absolute top-2 left-2 bg-red-500/75 text-white text-xs p-1 rounded">
          {error}
        </div>
      )}
      {!hasFrame && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black">
          <div className="w-6 h-6 border-2 border-[#00a5ff] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {!isConnected && !hasFrame && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
          No Signal
        </div>
      )}
    </div>
  );
};

export default VideoStream;