const { createStore } = require('zustand/vanilla');
const store = createStore((set) => ({
  count: 0,
  inc: () => set((state) => state)
}));
let updates = 0;
store.subscribe(() => { updates++; });
store.getState().inc();
store.getState().inc();
console.log('Updates:', updates);
