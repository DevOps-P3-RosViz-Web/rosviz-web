'use client';

import React from 'react';
import PointCloudViewer from './PointCloudViewer';
import { resolveRobotTopic } from '@/lib/robot-topics';

interface PointCloudProps {
  robotId: string;
}

const PointCloud = ({ robotId }: PointCloudProps) => {
  return <PointCloudViewer topic={resolveRobotTopic(robotId, '/scan/points')} />;
};

export default PointCloud;
