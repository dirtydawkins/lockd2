using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("OVERCLOCK Connect Preview")]
[assembly: AssemblyProduct("LOCKD OVERCLOCK")]
[assembly: AssemblyVersion("0.1.1.0")]
[assembly: AssemblyFileVersion("0.1.1.0")]

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
            ClientSize = new Size(530, 330);
            MinimumSize = new Size(380, 320);
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            BackColor = Color.FromArgb(247, 244, 239);
            ForeColor = Color.FromArgb(25, 24, 23);
            Font = new Font("Segoe UI", 11);
            var layout = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill, AutoScroll = true, WrapContents = false,
                FlowDirection = FlowDirection.TopDown, Padding = new Padding(25)
            };
            Controls.Add(layout);
            using (Stream stream = typeof(ConnectWindow).Assembly.GetManifestResourceStream("OverclockConnect.ico"))
            using (var artwork = new Icon(stream, 48, 48))
            {
                Icon = (Icon)artwork.Clone();
                layout.Controls.Add(new PictureBox
                {
                    Image = artwork.ToBitmap(), Size = new Size(48, 48), SizeMode = PictureBoxSizeMode.Zoom
                });
            }
            layout.Controls.Add(new Label { Text = "OVERCLOCK Connect", AutoSize = true, Font = new Font("Segoe UI", 21, FontStyle.Bold) });
            layout.Controls.Add(new Label
            {
                Text = "Request early access to a remote workstation on LOCKD.",
                AutoSize = true, MaximumSize = new Size(320, 0), Margin = new Padding(3, 8, 3, 17)
            });
            var open = AddButton(layout, "Open pilot page");
            open.BackColor = Color.FromArgb(84, 29, 40);
            open.ForeColor = Color.White;
            open.FlatStyle = FlatStyle.Flat;
            open.Click += (sender, args) =>
            {
                try { Process.Start(new ProcessStartInfo(Pilot.AbsoluteUri) { UseShellExecute = true }); }
                catch (System.ComponentModel.Win32Exception) { result.Text = "Your default browser couldn’t open LOCKD."; }
            };
            var check = AddButton(layout, "Check connection to LOCKD");
            check.Click += async (sender, args) =>
            {
                check.Enabled = false;
                result.Text = "Checking LOCKD…";
                try { result.Text = await CheckWebsite(); }
                finally { if (!IsDisposed) check.Enabled = true; }
            };
            layout.Controls.Add(result);
            AcceptButton = open;
        }

        static Button AddButton(FlowLayoutPanel container, string text)
        {
            var button = new Button { Text = text, AutoSize = true, MinimumSize = new Size(215, 38), TextAlign = ContentAlignment.MiddleCenter };
            container.Controls.Add(button);
            return button;
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
