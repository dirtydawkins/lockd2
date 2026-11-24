using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("OVERCLOCK Connect")]
[assembly: AssemblyProduct("LOCKD OVERCLOCK")]
[assembly: AssemblyVersion("0.3.0.0")]
[assembly: AssemblyFileVersion("0.3.0.0")]

namespace OverclockConnect
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ConnectWindow());
        }
    }

    sealed class ConnectWindow : Form
    {
        static readonly Uri Pilot = new Uri("https://lockd2.vercel.app/overclock.html");
        static readonly HttpClient Http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
        {
            Timeout = TimeSpan.FromSeconds(8)
        };
        readonly Label result = new Label { AutoSize = true, MaximumSize = new Size(430, 0), AccessibleName = "Connection check result" };

        public ConnectWindow()
        {
            Text = "OVERCLOCK Connect";
            ClientSize = new Size(890, 520);
            MinimumSize = new Size(620, 440);
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            BackColor = Color.FromArgb(24, 23, 26);
            ForeColor = Color.WhiteSmoke;
            Font = new Font("Segoe UI", 10);
            var shell = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1 };
            shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 174));
            shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            Controls.Add(shell);
            shell.Controls.Add(rail, 0, 0);
            shell.Controls.Add(content, 1, 0);
            rail.BackColor = Surface;
            using (Stream stream = GetType().Assembly.GetManifestResourceStream("OverclockConnect.ico"))
            using (var artwork = new Icon(stream, 48, 48))
            {
                Icon = (Icon)artwork.Clone();
                rail.Controls.Add(new PictureBox { Image = artwork.ToBitmap(), Size = new Size(48, 48) });
            }
            Copy(rail, "Connect", 18);
            foreach (var page in new[] { "Home", "My PC", "Connection", "Settings" })
            {
                string target = page;
                var button = Action(rail, target, false);
                button.Width = 130;
                button.Click += delegate { ShowPage(target); };
            }
            ShowPage("Home");
        }

        static readonly Color Surface = Color.FromArgb(43, 40, 44);
        static readonly Color Accent = Color.FromArgb(142, 43, 66);
        readonly FlowLayoutPanel rail = Column(16);
        readonly FlowLayoutPanel content = Column(28);
        string lastResult = "Ready to check.";
        bool checking;
        bool scanning;
        string hardware = "";

        static FlowLayoutPanel Column(int padding)
        {
            return new FlowLayoutPanel { Dock = DockStyle.Fill, AutoScroll = true, WrapContents = false,
                FlowDirection = FlowDirection.TopDown, Padding = new Padding(padding) };
        }

        static void Copy(FlowLayoutPanel parent, string text, int size)
        {
            parent.Controls.Add(new Label { Text = text, Font = new Font("Segoe UI", size), AutoSize = true,
                MaximumSize = new Size(385, 0), Margin = new Padding(0, 3, 0, 14) });
        }

        static Button Action(FlowLayoutPanel parent, string title, bool primary)
        {
            var button = new Button { Text = title, AutoSize = true, FlatStyle = FlatStyle.Flat,
                Padding = new Padding(12, 5, 12, 5), BackColor = primary ? Accent : Surface, ForeColor = Color.White,
                Margin = new Padding(0, 2, 0, 8) };
            button.FlatAppearance.BorderSize = 0;
            parent.Controls.Add(button);
            return button;
        }

        void Link(string title, string path, bool primary)
        {
            Action(content, title, primary).Click += delegate {
                try { Process.Start(new ProcessStartInfo(new Uri(Pilot, path).AbsoluteUri) { UseShellExecute = true }); }
                catch (System.ComponentModel.Win32Exception) { MessageBox.Show(this, "Your browser couldn’t open LOCKD."); }
            };
        }

        void ShowPage(string page)
        {
            content.SuspendLayout();
            content.Controls.Remove(result);
            while (content.Controls.Count > 0) content.Controls[0].Dispose();
            foreach (Control item in rail.Controls)
                if (item is Button) item.BackColor = item.Text == page ? Accent : Surface;
            Copy(content, "LOCKD   /   OVERCLOCK", 9);
            if (page == "Home")
            {
                Copy(content, "Your workspace", 28);
                Copy(content, "Studio access", 16);
                Copy(content, "Manage your request for a remote workstation in your LOCKD account.", 11);
                Link("Manage Studio access", "overclock.html#access", true);
                Action(content, "Check connection", false).Click += delegate { ShowPage("Connection"); };
            }
            else if (page == "My PC")
            {
                Copy(content, "Your PC", 26);
                Copy(content, "Check the processor, graphics and memory. Review the details before sending them to LOCKD for review.", 11);
                var specs = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
                    Width = 330, Height = 94, AccessibleName = "PC specifications", Text = hardware };
                content.Controls.Add(specs);
                var inspect = Action(content, "Check this PC", true);
                var open = Action(content, "Register this PC", false);
                inspect.Enabled = !scanning;
                open.Enabled = hardware.Length > 0;
                inspect.Click += async delegate {
                    scanning = true;
                    inspect.Enabled = open.Enabled = false;
                    specs.Text = "Checking this PC…";
                    try { hardware = await Task.Run(new Func<string>(Hardware.Inspect)); }
                    catch (Exception error) {
                        if (!(error is System.Management.ManagementException || error is UnauthorizedAccessException ||
                              error is System.Runtime.InteropServices.COMException || error is System.Security.SecurityException)) throw;
                        hardware = "";
                    }
                    finally { scanning = false; }
                    if (IsDisposed || Disposing) return;
                    if (!specs.IsDisposed) {
                        specs.Text = hardware.Length == 0 ? "Windows could not read these details. You can enter them in your listing." : hardware;
                        inspect.Enabled = true;
                        open.Enabled = hardware.Length > 0;
                    } else if (content.Tag as string == "My PC") ShowPage("My PC");
                };
                open.Click += delegate {
                    var link = new Uri(Pilot, "overclock.html#pc-specs=" + Uri.EscapeDataString(hardware));
                    try { Process.Start(new ProcessStartInfo(link.AbsoluteUri) { UseShellExecute = true }); }
                    catch (System.ComponentModel.Win32Exception) { MessageBox.Show(this, "Copy the specifications into the Computers section of your LOCKD listing."); }
                };
            }
            else if (page == "Connection")
            {
                Copy(content, "Connection check", 26);
                Copy(content, "Check whether this PC can reach the LOCKD website.", 11);
                result.Text = lastResult;
                content.Controls.Add(result);
                var check = Action(content, "Run check", true);
                check.Enabled = !checking;
                check.Click += async delegate {
                    checking = true;
                    check.Enabled = false;
                    result.Text = lastResult = "Checking…";
                    var timer = Stopwatch.StartNew();
                    string response = await CheckWebsite();
                    checking = false;
                    lastResult = response.StartsWith("The LOCKD pilot") ? "Website reachable   ·   " + timer.ElapsedMilliseconds + " ms" : response;
                    if (!IsDisposed && content.Controls.Contains(result)) ShowPage("Connection");
                };
            }
            else
            {
                Copy(content, "Account & settings", 26);
                Copy(content, "Your profile and preferences open in your usual browser.", 11);
                Link("Account settings", "settings.html", true);
                Link("Privacy notice", "privacy.html", false);
                Copy(content, "Connect 0.3.0   /   Windows x64", 10);
            }
            content.Tag = page;
            content.ResumeLayout(true);
        }

        static async Task<string> CheckWebsite()
        {
            try
            {
                using (var request = new HttpRequestMessage(HttpMethod.Head, Pilot))
                using (var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead))
                {
                    return response.StatusCode == HttpStatusCode.OK
                        ? "The LOCKD pilot page is reachable."
                        : "LOCKD responded, but the pilot page is unavailable.";
                }
            }
            catch (HttpRequestException) { return "Couldn’t reach LOCKD. Check your internet connection."; }
            catch (TaskCanceledException) { return "LOCKD took too long to reply. Try again."; }
        }
    }
}
