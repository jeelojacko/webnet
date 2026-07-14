export const addUniqueCoordSystemWarning = ({
  coordSystemWarningMessages,
  coordWarningSeen,
  log,
  warning,
}: {
  coordSystemWarningMessages: string[];
  coordWarningSeen: Set<string>;
  log: (_message: string) => void;
  warning: string;
}): void => {
  const normalized = warning.trim();
  if (!normalized) return;
  if (coordWarningSeen.has(normalized)) return;
  coordWarningSeen.add(normalized);
  coordSystemWarningMessages.push(normalized);
  log(`Warning: ${normalized}`);
};
