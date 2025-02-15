import sys,json,numpy as np,tkinter as tk,matplotlib.pyplot as plt,pyperclip; from tkinter import ttk,filedialog; from matplotlib import rcParams; from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg; from matplotlib.animation import FuncAnimation
if sys.platform.startswith('win'): import winreg
rcParams.update({'font.family':'sans-serif','axes.facecolor':'#0d1117','figure.facecolor':'#0d1117','axes.labelcolor':'white','text.color':'white','xtick.color':'white','ytick.color':'white','grid.color':'#30363d','grid.alpha':0.3})
def parse_value(v,d):
	try: return list(map(float,v.split(','))) if ',' in v else float(v) if '.' in v else int(v)
	except: return d
def get_config(e,d): return {k: parse_value(e[k].get(),d[k]) if k in e else d[k] for k in d}
def validate_config(c):
	req=["input_range","phase_boundaries","response_ratios","dpi"]
	if any(k not in c for k in req) or not all(c['phase_boundaries'][i]<c['phase_boundaries'][i+1] for i in range(len(c['phase_boundaries'])-1)) or len(c['response_ratios'])!=len(c['phase_boundaries'])+1:
		raise ValueError("Config error")
def neuromorphic_transition(t,dpi): return 1/(1+np.exp(-(2.5+dpi/800)*(t-0.6)*10))+0.2*np.sin(2*np.pi*t)
def generate_curve(c):
	x=np.arange(1,c['input_range']+1); b=np.array(c['phase_boundaries']); r=np.array(c['response_ratios']); dpi=c['dpi']
	ind=np.searchsorted(b,x,side='right'); y=np.empty_like(x,dtype=float); mask=ind<len(b)
	if np.any(mask):
		low=np.where(ind[mask]==0,0,b[ind[mask]-1]); up=b[ind[mask]]; t=(x[mask]-low)/(up-low)
		y[mask]=r[ind[mask]]+(r[ind[mask]+1]-r[ind[mask]])*neuromorphic_transition(t,dpi)
	if np.any(~mask): y[~mask]=r[-1]*(0.97+0.03*np.tanh((x[~mask]-b[-1])/50))
	return x,y
REG_PATH=r"Software\NeuroAdaptiveVisualizer"
def load_config(d):
	if not sys.platform.startswith('win'): return d.copy()
	try:
		with winreg.OpenKey(winreg.HKEY_CURRENT_USER,REG_PATH,0,winreg.KEY_READ) as k:
			cfg=d.copy()
			for key in d:
				try:
					val,_=winreg.QueryValueEx(k,key); cfg[key]=json.loads(val) if isinstance(d[key],list) else type(d[key])(val)
				except: pass
			return cfg
	except: return d.copy()
def save_config(c):
	if not sys.platform.startswith('win'): return
	try:
		with winreg.CreateKey(winreg.HKEY_CURRENT_USER,REG_PATH) as k:
			for key,v in c.items(): winreg.SetValueEx(k,key,0,winreg.REG_SZ,json.dumps(v) if isinstance(v,list) else str(v))
	except: pass
class NeuroVisualizer:
	def __init__(self):
		self.defaults={"input_range":257,"phase_boundaries":[20.0,55.0,110.0],"response_ratios":[0.3,0.65,1.0,2.0],"dpi":1600}
		self.current_config=load_config(self.defaults); self.selected_dpi=self.current_config.get('dpi',self.defaults['dpi'])
		self.root=tk.Tk(); self.root.title("NeuroAdaptive Visualizer")
		if sys.platform.startswith("win"):
			import ctypes; GWL_STYLE=-16; WS_CAPTION=0x00C00000; hwnd=self.root.winfo_id(); style=ctypes.windll.user32.GetWindowLongW(hwnd,GWL_STYLE); style&=~WS_CAPTION; ctypes.windll.user32.SetWindowLongW(hwnd,GWL_STYLE,style)
		else:
			self.root.overrideredirect(True); self.title_bar=tk.Frame(self.root,bg='#2d2d2d',relief='raised',bd=0); self.title_bar.grid(row=0,column=0,columnspan=2,sticky="ew")
			def close_window(): self.root.destroy()
			def minimize_window(): self.root.overrideredirect(False); self.root.iconify(); self.root.bind("<Map>",lambda e: self.root.overrideredirect(True))
			btn_close=tk.Canvas(self.title_bar,width=12,height=12,bg='#2d2d2d',highlightthickness=0); btn_close.create_oval(2,2,10,10,fill="#ff5c5c",outline="#ff5c5c"); btn_close.pack(side=tk.LEFT,padx=6,pady=4); btn_close.bind("<Button-1>",lambda e: close_window())
			btn_min=tk.Canvas(self.title_bar,width=12,height=12,bg='#2d2d2d',highlightthickness=0); btn_min.create_oval(2,2,10,10,fill="#ffbd4c",outline="#ffbd4c"); btn_min.pack(side=tk.LEFT,padx=6,pady=4); btn_min.bind("<Button-1>",lambda e: minimize_window())
			self.title_bar.bind("<ButtonPress-1>",lambda e: (setattr(self,'x',e.x),setattr(self,'y',e.y))); self.title_bar.bind("<B1-Motion>",lambda e: self.root.geometry(f"+{self.root.winfo_x()+e.x-self.x}+{self.root.winfo_y()+e.y-self.y}")); self.title_bar.bind("<ButtonRelease-1>",lambda e: setattr(self,'x',None))
		self.root.grid_rowconfigure(1,weight=1); self.root.grid_columnconfigure(0,weight=2); self.root.grid_columnconfigure(1,weight=0)
		width,height=1278,670; sw=self.root.winfo_screenwidth(); sh=self.root.winfo_screenheight(); x=(sw-width)//2; y=(sh-height)//2
		self.root.minsize(width,height); self.root.maxsize(width,height); self.root.geometry(f"{width}x{height}+{x}+{y}")
		self.left_frame=tk.Frame(self.root); self.left_frame.grid(row=1,column=0,sticky="nsew")
		self.right_container=tk.Frame(self.root,bg='#0d1117',width=320,bd=0,highlightthickness=0); self.right_container.grid(row=1,column=1,sticky="nsew",padx=0,pady=0); self.right_container.grid_propagate(False)
		self.right_container.columnconfigure(0,weight=1); self.right_container.rowconfigure(1,weight=1)
		self.config_frame=tk.Frame(self.right_container,bg='#0d1117',bd=0,highlightthickness=0); self.config_frame.grid(row=0,column=0,sticky="ew",pady=(10,10),padx=5)
		self.output_frame=tk.Frame(self.right_container,bg='#0d1117',bd=0,highlightthickness=0); self.output_frame.grid(row=1,column=0,sticky="nsew",padx=5); self.output_frame.grid_propagate(False)
		self.style=ttk.Style(); self.style.theme_use('clam'); self.style.configure("Custom.Vertical.TScrollbar",gripcount=0,background="#30363d",darkcolor="#30363d",lightcolor="#30363d",troughcolor="#0d1117",bordercolor="#0d1117",arrowcolor="#58a6ff",relief="flat")
		self.button_font=("Helvetica",10,"bold"); self.hover_color="#2c5282"; self.copy_button=None
		self.create_config_ui(); self.update_plot()
		tk.Label(self.root,text="Created by Greyxp1",bg='#0d1117',fg='white',font=("Helvetica",8,"italic")).place(relx=0.0,rely=1.0,anchor='sw',x=10,y=-10)
	def create_button(self,parent,text,command,bg="#58a6ff",hover_bg="#2c5282"):
		btn=tk.Button(parent,text=text,bg=bg,fg="white",font=self.button_font,cursor="hand2",relief="flat",borderwidth=0,command=command)
		btn.bind("<Enter>",lambda e: btn.configure(background=hover_bg)); btn.bind("<Leave>",lambda e: btn.configure(background=bg)); return btn
	def create_config_ui(self):
		fld=[("Select DPI","dpi"),("Phase Boundaries","phase_boundaries"),("Response Ratios","response_ratios")]; self.config_vars={}
		for i,(lbl,key) in enumerate(fld,1):
			tk.Label(self.config_frame,text=lbl,bg='#0d1117',fg='white',font=("Helvetica",10,"bold")).grid(row=i,column=0,padx=10,pady=5,sticky="w")
			if key!="dpi":
				e=tk.Entry(self.config_frame,bg='#30363d',fg='white',insertbackground='white',font=("Consolas",10),relief="flat",borderwidth=1)
				dflt=self.current_config.get(key,self.defaults[key]); e.insert(0,', '.join(map(str,dflt)) if isinstance(dflt,list) else str(dflt))
				e.grid(row=i,column=1,padx=10,pady=5,sticky="ew"); self.config_vars[key]=e
			else:
				d_frame=tk.Frame(self.config_frame,bg='#0d1117'); d_frame.grid(row=i,column=1,padx=10,pady=5,sticky="w"); self.dpi_canvases={}
				for dpi in [800,1600,3200]:
					f=tk.Frame(d_frame,bg='#0d1117'); f.pack(side=tk.LEFT,padx=5); c=tk.Canvas(f,width=40,height=25,bg='#0d1117',highlightthickness=0,bd=0); c.pack()
					color='#58a6ff' if dpi==self.selected_dpi else '#30363d'; c.create_rectangle(2,2,38,23,fill=color,outline="",tags="rect"); c.create_text(20,12,text=str(dpi),fill='white',font=("Helvetica",9,"bold"))
					c.bind("<Button-1>",lambda e,d=dpi: self.set_dpi(d)); self.dpi_canvases[dpi]=c; tooltip_text=f"DPI: {dpi}\nRecommended for {'low' if dpi==800 else 'medium' if dpi==1600 else 'high'} sensitivity"
					c.bind("<Enter>",lambda e,t=tooltip_text: self.show_tooltip(e,t)); c.bind("<Leave>",self.hide_tooltip)
		self.create_button(self.config_frame,"Update",self.update_plot).grid(row=len(fld)+1,column=0,columnspan=2,padx=10,pady=5,sticky="ew")
		self.create_button(self.config_frame,"Reset",self.reset_config,bg="#da3633",hover_bg="#a12828").grid(row=len(fld)+2,column=0,columnspan=2,padx=10,pady=5,sticky="ew")
		self.create_button(self.config_frame,"Import Profile",self.import_profile,bg="#3b82f6",hover_bg="#2563eb").grid(row=len(fld)+3,column=0,columnspan=2,padx=10,pady=5,sticky="ew")
		self.create_button(self.config_frame,"Export Profile",self.export_profile,bg="#10b981",hover_bg="#059669").grid(row=len(fld)+4,column=0,columnspan=2,padx=10,pady=5,sticky="ew")
	def show_tooltip(self,event,text):
		x,y,_,_=event.widget.bbox("all"); x+=event.widget.winfo_rootx()+25; y+=event.widget.winfo_rooty()+20
		self.tooltip=tk.Toplevel(); self.tooltip.wm_overrideredirect(True); self.tooltip.wm_geometry(f"+{x}+{y}")
		tk.Label(self.tooltip,text=text,justify=tk.LEFT,background="#1f2937",fg="white",relief="solid",borderwidth=1,font=("Helvetica",9),padx=5,pady=3).pack()
	def hide_tooltip(self,event=None):
		if hasattr(self,'tooltip'): self.tooltip.destroy(); self.tooltip=None
	def set_dpi(self,d):
		if self.selected_dpi==d: return
		self.selected_dpi=d
		for dd,c in self.dpi_canvases.items(): c.itemconfig("rect",fill='#58a6ff' if dd==d else '#30363d')
		self.update_plot()
	def update_plot(self):
		cfg=get_config(self.config_vars,self.defaults); cfg['dpi']=self.selected_dpi
		try: validate_config(cfg)
		except Exception as e: print("Configuration Error:",e); return
		if cfg['dpi']!=self.current_config.get('dpi',self.defaults['dpi']):
			s=cfg['dpi']/self.current_config.get('dpi',self.defaults['dpi'])
			for k in ['phase_boundaries','response_ratios']:
				cur=parse_value(self.config_vars[k].get(),self.defaults[k]); scaled=[x*s if k=='phase_boundaries' else x/s for x in cur]
				self.config_vars[k].delete(0,tk.END); self.config_vars[k].insert(0,', '.join(map(str,scaled)))
			cfg=get_config(self.config_vars,self.defaults); cfg['dpi']=self.selected_dpi
		self.current_config=cfg; save_config(cfg)
		x,y=generate_curve(cfg); self.draw_curve(x,y,cfg); self.update_text(x,y,cfg)
	def draw_curve(self,x,y,cfg):
		if hasattr(self,'canvas'):
			fig=self.canvas.figure; fig.clf(); ax=fig.add_subplot(111)
			if hasattr(self,'anim') and self.anim is not None and getattr(self.anim,"event_source",None): self.anim.event_source.stop()
		else:
			fig=plt.Figure(figsize=(8,10),dpi=120); ax=fig.add_subplot(111); self.canvas=FigureCanvasTkAgg(fig,master=self.left_frame); self.canvas.get_tk_widget().pack(fill=tk.BOTH,expand=True)
			self.canvas.get_tk_widget().grid(row=0,column=0,sticky="nsew"); self.left_frame.grid_rowconfigure(0,weight=1); self.left_frame.grid_columnconfigure(0,weight=1)
		ax.plot(x,y,color='#1f6feb',lw=8,alpha=0.15,zorder=4); self.line,=ax.plot([],[],color='#58a6ff',lw=3,zorder=5)
		valid=x[x<=max(cfg['phase_boundaries'])]; xmax=np.max(valid) if valid.size>0 else np.max(x)
		ax.set_xlim(np.min(x),xmax+xmax*0.15); ax.set_ylim(np.min(y),np.max(y)*1.1); ax.set_aspect('auto')
		try: bd=[float(v) for v in self.config_vars['phase_boundaries'].get().split(',')]
		except: bd=[]
		for b in bd: ax.axvline(b,color='white',ls='--',lw=1,alpha=0.8)
		if len(bd)>=3:
			for xp,lbl,clr in zip(bd[:3],["Precision\n Control","Dynamic\n Response","Stabilized\n Output"],['#238636','#da3633','#8957e5']):
				ax.text(xp,np.max(y)*1.08,lbl,ha='center',va='top',color=clr,fontsize=10,fontweight='bold',bbox=dict(boxstyle="round,pad=0.3",fc='#0d1117',ec=clr))
		if len(bd)>=2:
			try: rat=[float(r.strip()) for r in self.config_vars['response_ratios'].get().split(',')]
			except: rat=[0,0,0,0]
			ax.annotate(f"Microscale Domain\n(base: {rat[0]})",xy=(bd[0],np.interp(bd[0],x,y)),xytext=(25,-40),textcoords='offset points',arrowprops=dict(arrowstyle="->",color='#2ea043'),bbox=dict(boxstyle="round,pad=0.3",fc='#0d1117',ec='#30363d',alpha=0.9),color='#2ea043',fontsize=9,ha='center',zorder=11,clip_on=False)
			ax.annotate(f"Transition Gradient\nΔR = {rat[1]-rat[0]:+.2f}",xy=(bd[1],np.interp(bd[1],x,y)),xytext=(20,-45),textcoords='offset points',arrowprops=dict(arrowstyle="->",color='#da3633'),bbox=dict(boxstyle="round,pad=0.3",fc='#0d1117',ec='#30363d',alpha=0.9),color='#da3633',fontsize=9,ha='center',zorder=11,clip_on=False)
			ax.annotate(f"Stabilized Output\nσ = {rat[-1]:.2f}±0.03",xy=((bd[1]+bd[2])/2 if len(bd)>2 else bd[1],np.interp((bd[1]+bd[2])/2 if len(bd)>2 else bd[1],x,y)),xytext=(40,-40),textcoords='offset points',arrowprops=dict(arrowstyle="->",color='#8957e5'),bbox=dict(boxstyle="round,pad=0.3",fc='#0d1117',ec='#30363d',alpha=0.9),color='#8957e5',fontsize=9,ha='center',zorder=11,clip_on=False)
		ax.set_xlabel('Input Velocity',fontsize=12,labelpad=10); ax.set_ylabel('Sens Multiplier',fontsize=12,labelpad=10); ax.set_title("NeuroAdaptive Response Profile",pad=20,fontsize=16,fontweight='bold'); ax.grid(True,ls='--',alpha=0.4)
		fig.subplots_adjust(top=0.9,bottom=0.13,left=0.11,right=0.99); dx=np.diff(x); dy=np.diff(y); distances=np.sqrt(dx**2+dy**2); arc_length=np.concatenate(([0],np.cumsum(distances)))
		total_duration=1.0; fps=60; total_frames=int(total_duration*fps); interval=(total_duration*1000)/total_frames
		def update(frame):
			target=(frame/total_frames)*arc_length[-1]; idx=np.searchsorted(arc_length,target); self.line.set_data(x[:idx],y[:idx]); return self.line,
		self.anim=FuncAnimation(fig,update,frames=total_frames+1,interval=interval,blit=True,repeat=False)
		self.canvas.draw(); self.canvas.get_tk_widget().grid(row=0,column=0,sticky="nsew"); self.left_frame.grid_rowconfigure(0,weight=1); self.left_frame.grid_columnconfigure(0,weight=1)
	def update_text(self,x,y,cfg):
		for w in self.output_frame.winfo_children():
			if w!=self.copy_button: w.destroy()
		self.output_frame.grid_rowconfigure(0,weight=1); self.output_frame.grid_columnconfigure(0,weight=1)
		txt=tk.Text(self.output_frame,wrap=tk.NONE,font=("Consolas",10),bg='#0d1117',fg='white',insertbackground='white',highlightthickness=0,bd=0,relief="flat")
		txt.grid(row=0,column=0,sticky="nsew",padx=10,pady=(10,5))
		txt.insert(tk.END,"Neuroadaptive Response Profile\nDPI: "+str(cfg['dpi'])+"\nPhase Boundaries: "+str(cfg['phase_boundaries'])+"\nResponse Ratios: "+str(cfg['response_ratios'])+"\n\n"+"\n".join(f"{xi:.0f},{yi:.6f}" for xi,yi in zip(x,y)))
		if not self.copy_button:
			self.copy_button=self.create_button(self.output_frame,"Copy",lambda: self.copy_data(x,y)); self.copy_button.grid(row=1,column=0,sticky="ew",padx=10,pady=(5,10))
		else:
			self.copy_button.configure(command=lambda: self.copy_data(x,y)); self.copy_button.grid(row=1,column=0,sticky="ew",padx=10,pady=(5,10))
		self.output_frame.update_idletasks()
	def copy_data(self,x,y):
		try:
			pyperclip.copy(";".join(f"{xi:.0f},{yi:.6f}" for xi,yi in zip(x,y)))
			self.copy_button.configure(bg="#22c55e",text="✓ Copied!"); self.root.after(2000,lambda: self.copy_button.configure(bg="#58a6ff",text="Copy"))
		except Exception as e:
			print("Copy failed:",e); self.copy_button.configure(bg="#dc2626",text="✗ Error"); self.root.after(2000,lambda: self.copy_button.configure(bg="#58a6ff",text="Copy"))
	def reset_config(self):
		self.current_config=self.defaults.copy()
		for k in self.defaults:
			if k in ["input_range","dpi"]: continue
			e=self.config_vars.get(k); e.delete(0,tk.END); dflt=self.defaults[k]
			e.insert(0,', '.join(map(str,dflt)) if isinstance(dflt,list) else str(dflt))
		self.set_dpi(self.defaults['dpi']); self.update_plot()
	def import_profile(self):
		filename=filedialog.askopenfilename(filetypes=[("JSON Files","*.json")])
		if not filename: return
		try:
			with open(filename,"r") as f: data=json.load(f)
			for key in self.defaults:
				if key in data: self.current_config[key]=data[key]
			for key in self.config_vars:
				if key in data:
					value=data[key] if not isinstance(data[key],list) else ', '.join(map(str,data[key]))
					self.config_vars[key].delete(0,tk.END); self.config_vars[key].insert(0,value)
			if "dpi" in data: self.set_dpi(data["dpi"])
			self.update_plot()
		except Exception as e: print("Import profile error:",e)
	def export_profile(self):
		filename=filedialog.asksaveasfilename(defaultextension=".json",filetypes=[("JSON Files","*.json")])
		if not filename: return
		try:
			with open(filename,"w") as f: json.dump(self.current_config,f,indent=4)
			print("Profile exported to",filename)
		except Exception as e: print("Export profile error:",e)
	def run(self): self.root.mainloop()
if __name__=="__main__": NeuroVisualizer().run()