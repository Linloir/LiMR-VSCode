// This browser module uses the reader's React and LiMR; bundle neither dependency.
export default function ({ React, limr }) {
  return limr.defineBlock({
    name: 'example-research-card',
    component: function ResearchCard({ children }) {
      return React.createElement('aside', { className: 'limr-example-research-card' }, children);
    },
  });
}
