(function (global) {
  "use strict";
  async function create({title,chapters,copiedNumbers}, loadFont) {
    const selected = global.ChapterExport.select(chapters,copiedNumbers);
    const pdf = await global.PDFLib.PDFDocument.create();
    pdf.registerFontkit(global.fontkit);
    pdf.setTitle(String(title || "Novel"));
    pdf.setCreator("Select Clean Body Text");
    pdf.setLanguage("en");
    const readFont = loadFont || (async name => {
      const response = await fetch(chrome.runtime.getURL(`fonts/${name}`));
      if (!response.ok) throw new Error(`Bundled PDF font could not be read: ${name}`);
      return new Uint8Array(await response.arrayBuffer());
    });
    const latin = await pdf.embedFont(await readFont("NotoSans-Regular.ttf"), {subset:true,features:{liga:false,clig:false}});
    const fonts = [{font:latin,characters:new Set(latin.getCharacterSet())}];
    let cjkLoaded = false;
    const choices = new Map();
    async function prepare(text) {
      for (const character of text) {
        if (/\s/u.test(character) || choices.has(character)) continue;
        const code = character.codePointAt(0);
        let chosen = fonts.find(entry => entry.characters.has(code));
        if (!chosen && !cjkLoaded) {
          // Full embedding avoids fontkit's broken CJK subset glyph outlines.
          // This font is loaded only when the novel actually needs it.
          const font = await pdf.embedFont(await readFont("NotoSansSC.ttf"), {subset:false,features:{liga:false,clig:false}});
          fonts.push({font,characters:new Set(font.getCharacterSet())});cjkLoaded = true;
          chosen = fonts.find(entry => entry.characters.has(code));
        }
        if (!chosen) throw new Error(`PDF font does not support U+${code.toString(16).toUpperCase()}. Your text is safe; use Download TXT for this backup.`);
        choices.set(character,chosen.font);
      }
    }
    const width=595.28,height=841.89,margin=54,usable=width-margin*2;
    let page,y,paragraphCount=0;
    function newPage() {page=pdf.addPage([width,height]);y=height-margin;}
    function runs(text) {
      const result=[];
      for(const character of text) {
        const font=choices.get(character)||latin;
        if(result.at(-1)?.font===font) result.at(-1).text+=character;
        else result.push({font,text:character});
      }
      return result;
    }
    const widths=new Map();
    function measure(text,size) {
      const key=`${size}:${text}`;
      if(!widths.has(key)) widths.set(key,runs(text).reduce((total,run)=>total+run.font.widthOfTextAtSize(run.text,size),0));
      return widths.get(key);
    }
    function line(text,size) {
      const lineHeight=size*1.5;
      if(y-size<margin) newPage();
      let x=margin;
      for(const run of runs(text.trimEnd())) {
        page.drawText(run.text,{x,y:y-size,size,font:run.font});
        x+=run.font.widthOfTextAtSize(run.text,size);
      }
      y-=lineHeight;
    }
    async function paragraph(value,size=12) {
      const text=String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,"")
        .replace(/\s+/gu," ").trim();
      if(!text)return;
      await prepare(text);
      let buffer="",bufferWidth=0;
      for(const token of text.match(/\S+\s*/gu)||[]) {
        const tokenWidth=measure(token,size);
        if(buffer && bufferWidth+tokenWidth>usable){line(buffer,size);buffer="";bufferWidth=0;}
        if(tokenWidth<=usable){buffer+=token;bufferWidth+=tokenWidth;continue;}
        // Wrap long unbroken tokens and CJK prose without dropping characters.
        for(const character of token) {
          const charWidth=measure(character,size);
          if(buffer && bufferWidth+charWidth>usable){line(buffer,size);buffer="";bufferWidth=0;}
          buffer+=character;bufferWidth+=charWidth;
        }
      }
      if(buffer.trim())line(buffer,size);
      y-=size*0.6;
      if(++paragraphCount%40===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    for(const [index,chapter] of selected.entries()) {
      newPage();
      if(index===0 && title) {await paragraph(title,19);y-=8;}
      const paragraphs=chapter.cleanText.replace(/\r\n?/g,"\n").split(/\n+/);
      for(const [i,text] of paragraphs.entries()) {
        const heading=i===0 && text.length<180 && /^(?:#?\s*\d+|chapter\s+\d+)/i.test(text.trim());
        await paragraph(text,heading?14:12);
      }
    }
    // Text-only, single-column pages: no recurring headers or page numbers for
    // TTS to speak between paragraphs. Fonts carry Unicode extraction maps.
    return pdf.save();
  }
  global.ChapterPdf={create};
  if(typeof module!=="undefined"&&module.exports)module.exports=global.ChapterPdf;
})(globalThis);
