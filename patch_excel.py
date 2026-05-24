import re

with open('src/components/ElevationProfile/ElevationChart.tsx', 'r') as f:
    content = f.read()

pattern = re.compile(r'  const handleExportExcel = \(\) => \{.*?(?=  if \(\!profile\.length\))', re.DOTALL)

with open('replacement.txt', 'r') as f:
    new_func = f.read()

new_content = pattern.sub(lambda x: new_func, content)
with open('src/components/ElevationProfile/ElevationChart.tsx', 'w') as f:
    f.write(new_content)
print("Replaced!")
