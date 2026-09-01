const n=document.currentScript.src,s=n.substring(0,n.lastIndexOf("/")+1),l=new URL(n).searchParams,r={width_limit:l.get("width_limit")||768,position:["left","right"].includes(l.get("position"))?l.get("position"):"left",preload:["ALL","IDLE","NONE"].includes(l.get("preload"))?l.get("preload"):"IDLE"};function o(i,e){return new Promise((f,c)=>{let t;e==="css"?(t=document.createElement("link"),t.rel="stylesheet",t.href=i):e==="js"&&(t=document.createElement("script"),t.src=i),t&&(t.onload=()=>f(i),t.onerror=()=>c(i),document.head.appendChild(t))})}screen.width>=r.width_limit&&Promise.all([o(s+"waifu.css","css"),o(s+"live2d.min.js","js")]).then(()=>{Promise.all([o(s+"index.js","js")]).then(()=>{if(r.position==="right"){const i=Array.from(document.styleSheets).find(e=>e.href&&e.href.includes(s+"waifu.css"));if(i)try{for(let e of i.cssRules)e.style&&(e.selectorText==="#waifu-toggle"&&(e.style.left&&(e.style.right=e.style.left,e.style.removeProperty("left")),e.style.marginLeft&&(e.style.marginRight=e.style.marginLeft,e.style.removeProperty("margin-left"))),e.selectorText==="#waifu"&&e.style.left&&(e.style.right=e.style.left,e.style.removeProperty("left")),e.selectorText==="#waifu-tips"&&e.style.left&&(e.style.right=e.style.left,e.style.removeProperty("left")),e.selectorText==="#waifu-tool"&&e.style.right&&(e.style.left=e.style.right,e.style.removeProperty("right")))}catch(e){console.warn(e)}}initWidget({cdnPath:s,preload:r.preload,tools:["switch-model","info","quit"]})})});console.log(`
               .::.    .:::::.   :-------.
           .:=-:..-=.:-:    .=:  .::::-:        .      :-.:-:
         :=-:      ==:      .=-.--. .-      .::-==    -:.=:
       :==.       -==       -==-.   .:::. .-. ..-=:.--.--.-:
     .==:       .===-      -==:.- .-:   .--::.  -: -:.-..-    -:
    :=-         ====   :=:   :=:.-=-::=--:     -: - .: :. :.:-
   -=:          .::   :=  .-==:-=:.   =:-:  .--..: :  : :: ..
 .==:                 ==-::--:-=.   .-:  :--:. .     . :  .
.==:                   .:-=: .=-  .:-.        .    ...
-=:                 .:: :-   :====-.                 .
                  ::. .=:      .
                ::   -:
              ::   :-.
             -. .--.
            .===-.
`);
