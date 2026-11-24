using System;
using System.Collections.Generic;
using System.Management;

namespace OverclockConnect
{
    static class Hardware
    {
        static IEnumerable<string> Read(string query, string field)
        {
            using (var search = new ManagementObjectSearcher("root\\cimv2", query))
            using (var rows = search.Get())
                foreach (ManagementBaseObject row in rows)
                    using (row)
                    {
                        var value = Convert.ToString(row[field]).Trim();
                        if (value.Length > 0) yield return value;
                    }
        }

        public static string Inspect()
        {
            var parts = new List<string>();
            foreach (var cpu in Read("SELECT Name FROM Win32_Processor", "Name"))
                parts.Add("Processor: " + cpu);
            foreach (var gpu in Read("SELECT Name FROM Win32_VideoController", "Name"))
                parts.Add("Graphics: " + gpu);
            foreach (var ram in Read("SELECT TotalPhysicalMemory FROM Win32_ComputerSystem", "TotalPhysicalMemory"))
            {
                ulong bytes;
                if (ulong.TryParse(ram, out bytes) && bytes > 0)
                    parts.Add("Memory: " + (bytes / 1073741824d).ToString("0.#") + " GiB");
            }
            return string.Join(Environment.NewLine, parts);
        }
    }
}
