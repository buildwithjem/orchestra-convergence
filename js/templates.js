/* Orchestra Competition — file: js/templates.js
   Pre-built workflow templates. Selecting one in the topbar <select>
   clears the canvas and loads the preset nodes & edges. */
window.App = window.App || {};

const TEMPLATES = [
  {
    id: 'adversarial-convergence',
    name: 'Adversarial Convergence',
    description: 'Reviewer agents challenge each other to catch sycophancy',
    icon: '⚡',
    nodes: [
      { id:'t1', type:'agent', position:{x:80,y:160}, title:'Producer', agentName:'qwen-plus',
        prompt:'You are a content producer. Generate a short technical article (3-4 paragraphs) introducing multi-agent review systems and the risk of reviewer sycophancy.' },
      { id:'t2', type:'agent', position:{x:380,y:60}, title:'Reviewer A', agentName:'qwen-plus',
        prompt:'You are a critical reviewer. Score the following output from 1-10 on quality, accuracy, and completeness. Explain your score.' },
      { id:'t3', type:'agent', position:{x:380,y:280}, title:'Reviewer B', agentName:'qwen-max',
        prompt:'You are a second reviewer with a different expertise (focus on factual accuracy and edge cases). Score the output independently from 1-10 and explain.' },
      { id:'t4', type:'adversarial', position:{x:680,y:170}, title:'Adversarial', agentName:'qwen-max',
        prompt:'',
        adversarialPrompt:'You are a red-team adversarial reviewer. Your job is to find flaws the reviewers missed. If both reviewers gave high scores (>=8) but you find concrete issues, challenge the scores and list the missed flaws. If the reviews are genuinely sound, say "NO CHALLENGE" and explain why.' },
      { id:'t5', type:'condition', position:{x:980,y:170}, title:'Challenge?', conditionExpression:'true' },
      { id:'t6', type:'deliver', position:{x:1280,y:170}, title:'Deliver', outputPath:'./output/final.md' },
    ],
    edges: [
      { id:'te1', sourceNode:'t1', sourcePort:'out-0', targetNode:'t2', targetPort:'in-0' },
      { id:'te2', sourceNode:'t1', sourcePort:'out-0', targetNode:'t3', targetPort:'in-0' },
      { id:'te3', sourceNode:'t2', sourcePort:'out-0', targetNode:'t4', targetPort:'in-0' },
      { id:'te4', sourceNode:'t3', sourcePort:'out-0', targetNode:'t4', targetPort:'in-0' },
      { id:'te5', sourceNode:'t4', sourcePort:'out-0', targetNode:'t5', targetPort:'in-0' },
      { id:'te6', sourceNode:'t5', sourcePort:'out-0', targetNode:'t6', targetPort:'in-0' },
    ],
  },
  {
    id: 'standard-convergence',
    name: 'Standard Convergence',
    description: 'Baseline: iterative review without adversarial challenge',
    icon: '↻',
    nodes: [
      { id:'s1', type:'agent', position:{x:80,y:170}, title:'Producer', agentName:'qwen-plus',
        prompt:'You are a content producer. Generate a short technical article (3-4 paragraphs) introducing multi-agent review systems and the risk of reviewer sycophancy.' },
      { id:'s2', type:'agent', position:{x:380,y:80}, title:'Reviewer A', agentName:'qwen-plus',
        prompt:'You are a critical reviewer. Score the following output from 1-10 on quality, accuracy, and completeness. Explain your score.' },
      { id:'s3', type:'agent', position:{x:380,y:280}, title:'Reviewer B', agentName:'qwen-max',
        prompt:'You are a second reviewer with a different expertise. Score the output independently from 1-10 and explain.' },
      { id:'s4', type:'convergence', position:{x:680,y:170}, title:'Convergence', agentName:'qwen-plus',
        prompt:'Aggregate the two reviewer scores and produce the final polished article.',
        reviewPrompt:'Verify the aggregated article is accurate and complete. If not, request regeneration focusing on the weakest aspect.',
        maxRounds:3 },
      { id:'s5', type:'deliver', position:{x:980,y:170}, title:'Deliver', outputPath:'./output/final.md' },
    ],
    edges: [
      { id:'se1', sourceNode:'s1', sourcePort:'out-0', targetNode:'s2', targetPort:'in-0' },
      { id:'se2', sourceNode:'s1', sourcePort:'out-0', targetNode:'s3', targetPort:'in-0' },
      { id:'se3', sourceNode:'s2', sourcePort:'out-0', targetNode:'s4', targetPort:'in-0' },
      { id:'se4', sourceNode:'s3', sourcePort:'out-0', targetNode:'s4', targetPort:'in-0' },
      { id:'se5', sourceNode:'s4', sourcePort:'out-0', targetNode:'s5', targetPort:'in-0' },
    ],
  },
];

window.TEMPLATES = TEMPLATES;
window.App.TEMPLATES = TEMPLATES;
