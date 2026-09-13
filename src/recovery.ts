function errorName(error: unknown): string {
  if (error instanceof DOMException) return error.name;
  if (error && typeof error === "object" && "name" in error && typeof error.name === "string") {
    return error.name;
  }
  return "";
}

export function cameraFailureMessage(error: unknown): string {
  switch (errorName(error)) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was denied. Allow camera permission for this site in your browser, then try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No usable camera was found. Connect or enable a camera, then try again.";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "The camera is busy or could not be read. Close other camera apps or tabs, then try again.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "The camera cannot provide the requested video mode. Try another camera or browser.";
    default:
      return "Camera could not start. Check its connection, browser permission, and other camera apps, then try again.";
  }
}

export function cameraSupportMessage(): string | null {
  if (!window.isSecureContext) {
    return "Camera access requires a secure HTTPS page or localhost. Open this demo from its HTTPS classroom link.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser does not provide the camera API required by the demo. Use a current Chromium, Firefox, or Edge browser.";
  }
  return null;
}

export function storageFailureMessage(error: unknown): string {
  const name = errorName(error);
  if (name === "QuotaExceededError") {
    return "Browser storage is full. Free site storage or disk space, then retry. Existing saved work was not replaced.";
  }
  if (name === "SecurityError" || name === "InvalidStateError") {
    return "Browser storage is blocked or unavailable. Allow site storage and reload before collecting or training.";
  }
  return error instanceof Error
    ? error.message
    : "Browser storage is unavailable. Check site storage settings and reload.";
}
