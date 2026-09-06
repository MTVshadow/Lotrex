import { appendFileSync } from "node:fs";

import {
  DEPLOYMENT_FAULT_POINTS,
  type DeploymentFaultPoint,
  runDeploymentFaultPoint,
} from "./deploymentFaultInjection";

const point = process.argv[2] as DeploymentFaultPoint;
const markerPath = process.argv[3];

if (!DEPLOYMENT_FAULT_POINTS.includes(point) || markerPath === undefined) {
  process.exitCode = 2;
} else {
  appendFileSync(markerPath, `entered:${point}\n`);
  runDeploymentFaultPoint(point);
  appendFileSync(markerPath, `completed:${point}\n`);
}
