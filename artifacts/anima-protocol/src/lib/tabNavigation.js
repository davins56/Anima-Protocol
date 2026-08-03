// Tab navigation stack management for independent tab history
export const TAB_STACKS = {
  '/': ['/', '/chat'],
  '/characters': ['/characters'],
  '/animas': ['/animas'],
  '/meditation': ['/meditation'],
  '/settings': ['/settings'],
};

export const createTabNavigationManager = () => {
  const stacks = { ...TAB_STACKS };

  return {
    push: (tab, path) => {
      if (!stacks[tab]) stacks[tab] = [tab];
      if (stacks[tab][stacks[tab].length - 1] !== path) {
        stacks[tab].push(path);
      }
    },
    pop: (tab) => {
      if (!stacks[tab] || stacks[tab].length <= 1) return null;
      stacks[tab].pop();
      return stacks[tab][stacks[tab].length - 1];
    },
    getRootPath: (tab) => stacks[tab]?.[0] || tab,
    getCurrentPath: (tab) => stacks[tab]?.[stacks[tab].length - 1] || tab,
    resetStack: (tab) => {
      stacks[tab] = [stacks[tab][0]];
    },
    getStacks: () => stacks,
  };
};