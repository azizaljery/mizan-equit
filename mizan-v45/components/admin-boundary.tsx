'use client';
import {Component,type ReactNode} from 'react';

// Keep an admin rendering failure from unmounting stock analysis or the portfolio.
export class AdminBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  if(this.state.failed)return <section className="panel" id="mizan-admin" style={{marginTop:24}}><h2>إدارة ميزان</h2><p role="alert">تعذر عرض لوحة الإدارة. أعد فتحها للمحاولة مجددًا؛ لم تُحذف بياناتك.</p><button type="button" className="secondary-btn" onClick={()=>this.setState({failed:false})}>إعادة فتح الإدارة</button></section>;
  return this.props.children;
 }
}
