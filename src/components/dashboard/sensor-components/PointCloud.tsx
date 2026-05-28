'use client';

import React from 'react';
import PointCloudViewer from './PointCloudViewer';

type PointCloudProps =
  | {
      source?: "robot";
      robotId: number;
      topic?: string;
    }
  | {
      source: "global";
      topic: string;
    };

const PointCloud: React.FC<PointCloudProps> = (props) => {
  if (props.source === "global") {
    return <PointCloudViewer source="global" topic={props.topic} />;
  }
  return <PointCloudViewer source="robot" topic={props.topic ?? "/scan/points"} robotId={props.robotId} />;
};

export default PointCloud;
