/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <Cocoa/Cocoa.h>

#import "TreeWriter.h"

// XML elements
extern NSString  *ScanDumpElem;
extern NSString  *ScanInfoElem;
extern NSString  *ScanCommentsElem;
extern NSString  *FilterSetElem;
extern NSString  *FilterElem;
extern NSString  *FilterTestElem;
extern NSString  *FolderElem;
extern NSString  *FileElem;

// XML attributes of GrandPerspectiveScanDump
extern NSString  *AppVersionAttr;
extern NSString  *FormatVersionAttr;

// XML attributes of GrandPerspectiveScanInfo
extern NSString  *VolumePathAttr;
extern NSString  *VolumeSizeAttr;
extern NSString  *FreeSpaceAttr;
extern NSString  *ScanTimeAttr;
extern NSString  *FileSizeMeasureAttr;

// XML attributes of FilterSet
extern NSString  *PackagesAsFilesAttr;

// XML attributes of FilterTest
extern NSString  *InvertedAttr;

// XML attributes of Folder and File
extern NSString  *NameAttr;
extern NSString  *FlagsAttr;
extern NSString  *SizeAttr;
extern NSString  *CreatedAttr;
extern NSString  *ModifiedAttr;
extern NSString  *AccessedAttr;

/* Writes a tree to portable XML format. The entire tree can be restored from this data.
 */
@interface XmlTreeWriter : TreeWriter {
  NSAutoreleasePool  *autoreleasePool;
}
@end

@interface XmlTreeWriter (ProtectedMethods)

// Creates compressed text output.
- (TextOutput *)newTextOutput:(NSURL *)path;

// Writes the tree in XML format.
- (void) writeTree:(AnnotatedTreeContext *)tree options:(id)options;

@end
