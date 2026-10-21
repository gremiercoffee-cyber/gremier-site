const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('pay.html','utf8');
const data=html.match(/<script type="application\/json" id="payCityData">([\s\S]*?)<\/script>/)[1];
function fixture(){
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',style:{},focus(){this.focused=true;}});return elements.get(id);};
 element('payCityData').textContent=data;element('payAddress').value='Example street 1';
 const context=vm.createContext({document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){}},console,paymentLink:{total:100}});
 const source=html.slice(html.indexOf('let payZones = []'),html.indexOf('async function callCreatePayment'));
 vm.runInContext(source+`;globalThis.cityTest={onPayCityInput,choosePayCity,validatePayDelivery,getPayDeliveryInfo,exactPayCity,onPayCityKeydown,syncPayCity,setType:v=>payDeliveryType=v,setZones:v=>payZones=v};`,context);
 return {api:context.cityTest,element};
}
test('payment page embeds the complete maintained local city list',()=>{
 assert.deepEqual(JSON.parse(data),JSON.parse(fs.readFileSync('israel-cities.json','utf8')));
});
test('typed exact English and Hebrew city names are accepted without a dropdown click',()=>{
 for(const input of ['Jerusalem',' JERUSALEM ','ירושלים']){
  const {api,element}=fixture();element('payCity').value=input;api.onPayCityInput(input);
  assert.equal(api.validatePayDelivery(),'');assert.equal(api.getPayDeliveryInfo().city_en,'Jerusalem');
 }
});
test('autofill without input events resolves the city and correct zone price at validation',()=>{
 const {api,element}=fixture();api.setZones([{name_en:'Jerusalem',regular_price:12}]);element('payCity').value='Jerusalem';
 assert.equal(api.validatePayDelivery(),'');assert.equal(element('payTotalAmt').textContent,'₪112');
});
test('partial queries require selection, while clearing or editing a selected city invalidates it',()=>{
 const {api,element}=fixture();element('payCity').value='Jeru';api.onPayCityInput('Jeru');
 assert.match(api.validatePayDelivery(),/select a matching city/);assert.equal(api.getPayDeliveryInfo(),null);
 api.choosePayCity(0);assert.equal(api.validatePayDelivery(),'');
 element('payCity').value='Not a real city';api.onPayCityInput(element('payCity').value);
 assert.match(api.validatePayDelivery(),/select a matching city/);assert.equal(api.getPayDeliveryInfo(),null);
 element('payCity').value='';api.onPayCityInput('');assert.equal(api.getPayDeliveryInfo(),null);
});
test('keyboard selects the only suggestion and pickup still needs no city',()=>{
 const {api,element}=fixture();element('payCity').value='Jeru';api.onPayCityInput('Jeru');
 let prevented=false;api.onPayCityKeydown({key:'Enter',preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(api.validatePayDelivery(),'');
 api.setType('pickup');element('payCity').value='';element('payAddress').value='';
 assert.equal(api.validatePayDelivery(),'');assert.equal(api.getPayDeliveryInfo().delivery_type,'pickup');
});
