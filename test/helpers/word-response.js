// Transport-only mock. Live tests, not this helper, evaluate semantic accuracy.
module.exports = request => ({ id:'word-review-mock', model:'mock', choices:[{finish_reason:'stop',message:{content:JSON.stringify(
  Object.fromEntries(JSON.parse(request.messages[1].content).candidate.words.map((_,i)=>[`word_${i+1}`,{
    sourceMeaning:'Mock source sense.',proposedMeaning:'Mock proposed sense.',contrastCase:'Mock equivalent reading.',
    effect:'same_in_context',changeDisclosed:false,status:'pass',reason:'Mock semantic decision.'
  }]))
)}}] });
