export type StudyClock = {
  now(): Date;
};

export const systemStudyClock: StudyClock = {
  now: () => new Date(),
};

export const fixedStudyClock = (now: Date | string): StudyClock => {
  const fixed = new Date(now);
  return {
    now: () => new Date(fixed),
  };
};
