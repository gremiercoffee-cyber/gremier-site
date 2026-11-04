import {createRoot} from 'react-dom/client';
import {Component,type ReactNode} from 'react';
import Daynote from './App';
class Guard extends Component<{children:ReactNode},{error:boolean}>{state={error:false};static getDerivedStateFromError(){return{error:true};}render(){return this.state.error?<div style={{padding:30,fontFamily:'system-ui'}}><h1>Health Journal needs a refresh</h1><p>Your saved local entries and recording are kept.</p><button onClick={()=>location.reload()}>Reload</button></div>:this.props.children;}}
createRoot(document.getElementById('root')!).render(<Guard><Daynote/></Guard>);
if('serviceWorker'in navigator&&import.meta.env.PROD)window.addEventListener('load',()=>{void navigator.serviceWorker.register('/daynote/sw.js',{scope:'/daynote/'}).catch(()=>{});});
