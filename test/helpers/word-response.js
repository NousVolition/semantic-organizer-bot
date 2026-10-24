// Transport-only mock. Live tests, not this helper, evaluate semantic accuracy.
module.exports = request => {
  const {candidate,passages}=JSON.parse(request.messages[1].content);
  const claimFields=Object.fromEntries(Object.entries(require('../../contextual-fidelity').fidelityFields(candidate)).map(([k,value])=>[k,{
    candidateText:value,reading:'Mock reading.',withheldObject:'Mock object.',
    sourceBindings:[{passage:passages[0].id,quote:passages[0].text,referent:'Mock record.'}],contextAnchors:[],
    support:'supported',status:'pass',reason:'Mock evidence decision.'
  }]));
  return { id:'word-review-mock', model:'mock', choices:[{finish_reason:'stop',message:{content:JSON.stringify({
  ...Object.fromEntries(candidate.words.map((_,i)=>[`word_${i+1}`,{
    sourceMeaning:'Mock source sense.',proposedMeaning:'Mock proposed sense.',contrastCase:'Mock equivalent reading.',
    effect:'same_in_context',changeDisclosed:false,status:'pass',reason:'Mock semantic decision.'
  }])),claimFields
})}}] };
};
