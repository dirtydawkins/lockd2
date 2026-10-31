const {test}=require('node:test');
const assert=require('node:assert/strict');
const {presentation}=require('../image-presentation');
test('product and vehicle evidence remains fully visible even with a requested crop',()=>{
  for(const category of ['technology','phone','laptop','play','camera','audio','creative','drive']) {
    assert.equal(presentation({category,market_category:'phones',attributes:{image_presentation:[{fit:'cover'}]}}).fit,'contain');
  }
});
test('only finite explicit focal metadata affects editorial crops, including edge positions',()=>{
  assert.deepEqual(presentation({category:'stay',attributes:{image_presentation:[{focal_x:0,focal_y:100}]}}),{fit:'cover',focal:'0% 100%'});
  for(const focal_x of ['20',NaN,Infinity,-1,101])assert.equal(presentation({category:'stay',attributes:{image_presentation:[{focal_x,focal_y:30}]}}).focal,'50% 50%');
  assert.equal(presentation({category:'stay',attributes:{image_presentation:[{fit:'contain'}]}}).fit,'contain');
  assert.equal(presentation({category:'stay',attributes:{image_presentation:[{}, {focal_x:75,focal_y:25}]}},1).focal,'75% 25%');
});
