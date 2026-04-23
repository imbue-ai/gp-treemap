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

#import "RawTreeWriter.h"

#import "PlainFileItem.h"
#import "DirectoryItem.h"
#import "CompoundItem.h"

#import "UniformType.h"

#import "TreeContext.h"
#import "AnnotatedTreeContext.h"

#import "TreeVisitingProgressTracker.h"


static const int AUTORELEASE_PERIOD = 1024;


#define  HEADER_PATH NSLocalizedString( @"Path", @"Header in exported text file")
#define  HEADER_FILENAME NSLocalizedString( @"Filename", @"Header in exported text file")
#define  HEADER_SIZE NSLocalizedString( @"Size", @"Header in exported text file")
#define  HEADER_TYPE NSLocalizedString( @"Type", @"Header in exported text file")
#define  HEADER_CREATED NSLocalizedString( @"Created", @"Header in exported text file")
#define  HEADER_MODIFIED NSLocalizedString( @"Modified", @"Header in exported text file")
#define  HEADER_ACCESSED NSLocalizedString( @"Accessed", @"Header in exported text file")

@interface RawTreeWriter (PrivateMethods)

- (void) appendHeaders;

@end

@implementation RawTreeWriter

- (instancetype) init {
  if (self = [super init]) {
    autoreleasePool = nil;
  }
  return self;
}

- (void) dealloc {
  NSAssert(autoreleasePool == nil, @"autoreleasePool should be nil");

  [super dealloc];
}

- (void) writeTree:(AnnotatedTreeContext *)annotatedTree options:(id)optionsVal {
  options = optionsVal;

  TreeContext  *tree = annotatedTree.treeContext;
  if (options.headersEnabled) {
    [self appendHeaders];
  }
  [self appendFolderElement: tree.scanTree];

  [autoreleasePool release];
  autoreleasePool = nil;
}

@end // @implementation RawTreeWriter


@implementation RawTreeWriter (ProtectedMethods)

- (void) appendFolderElement:(DirectoryItem *)dirItem {
  [progressTracker processingFolder: dirItem];

  [self dumpItemContents: dirItem.fileItems];
  [self dumpItemContents: dirItem.directoryItems];

  [progressTracker processedFolder: dirItem];
  if (progressTracker.numFoldersProcessed % AUTORELEASE_PERIOD == 0) {
    // Flush auto-release pool to prevent high memory usage while writing is in progress.
    [autoreleasePool release];
    autoreleasePool = [[NSAutoreleasePool alloc] init];
  }
}

- (void) appendFileElement:(PlainFileItem *)fileItem {
  RawTreeColumnFlags  columnFlag = 0x01;
  BOOL  isFirst = YES;

  while (columnFlag <= ColumnAccessTime) {
    if ([options isColumnShown: columnFlag]) {
      if (!isFirst) {
        [self appendString: @"\t"];
      }

      switch (columnFlag) {
        case ColumnPath:
          [self appendString: fileItem.path];
          break;
        case ColumnName:
          [self appendString: fileItem.label];
          break;
        case ColumnSize:
          [self appendString: [NSString stringWithFormat: @"%qu", fileItem.itemSize]];
          break;
        case ColumnType:
          [self appendString: fileItem.uniformType.uniformTypeIdentifier];
          break;
        case ColumnCreationTime:
          [self appendString: [TreeWriter stringForTime: fileItem.creationTime]];
          break;
        case ColumnModificationTime:
          [self appendString: [TreeWriter stringForTime: fileItem.modificationTime]];
          break;
        case ColumnAccessTime:
          [self appendString: [TreeWriter stringForTime: fileItem.accessTime]];
          break;
      }

      isFirst = NO;
    }

    columnFlag <<= 1;
  }

  [self appendString: @"\n"];
}

@end // @implementation RawTreeWriter (ProtectedMethods)


@implementation RawTreeWriter (PrivateMethods)

- (void) appendHeaders {
  RawTreeColumnFlags  columnFlag = 0x01;
  BOOL  isFirst = YES;
  NSString  *header = nil;

  while (columnFlag <= ColumnAccessTime) {
    if ([options isColumnShown: columnFlag]) {
      if (!isFirst) {
        [self appendString: @"\t"];
      }

      switch (columnFlag) {
        case ColumnPath: header = HEADER_PATH; break;
        case ColumnName: header = HEADER_FILENAME; break;
        case ColumnSize: header = HEADER_SIZE; break;
        case ColumnType: header = HEADER_TYPE; break;
        case ColumnCreationTime: header = HEADER_CREATED; break;
        case ColumnModificationTime: header = HEADER_MODIFIED; break;
        case ColumnAccessTime: header = HEADER_ACCESSED; break;
      }
      [self appendString: header];

      isFirst = NO;
    }

    columnFlag <<= 1;
  }

  [self appendString: @"\n"];

}

@end // @implementation RawTreeWriter (PrivateMethods)
