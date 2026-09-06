export const DEPLOYMENT_FAULT_POINTS = [
  "after-backup",
  "after-unlink",
  "after-link",
  "after-manifest-write",
  "after-purge",
  "after-commit",
] as const;

export type DeploymentFaultPoint = (typeof DEPLOYMENT_FAULT_POINTS)[number];

export const DEPLOYMENT_FAULT_INJECTION_ENABLE_VALUE = "enabled-for-tests";

interface IFaultInjectionEnvironment {
  VORTEX_DEPLOYMENT_FAULT_INJECTION?: string;
  VORTEX_DEPLOYMENT_FAULT_POINT?: string;
}

export function isDeploymentFaultEnabled(
  point: DeploymentFaultPoint,
  environment: IFaultInjectionEnvironment = process.env,
): boolean {
  return (
    environment.VORTEX_DEPLOYMENT_FAULT_INJECTION === DEPLOYMENT_FAULT_INJECTION_ENABLE_VALUE &&
    environment.VORTEX_DEPLOYMENT_FAULT_POINT === point
  );
}

export function runDeploymentFaultPoint(
  point: DeploymentFaultPoint,
  environment: IFaultInjectionEnvironment = process.env,
  terminate: (pid: number) => void = (pid) => process.kill(pid, "SIGKILL"),
): void {
  if (!isDeploymentFaultEnabled(point, environment)) {
    return;
  }
  terminate(process.pid);
  throw new Error(`Deployment fault injection did not terminate the process at ${point}`);
}
